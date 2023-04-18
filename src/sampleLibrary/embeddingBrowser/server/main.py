import os
import tempfile
import shutil
from typing import List
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import asyncio
import fnmatch
import boto3
from botocore.client import Config
from botocore.exceptions import NoCredentialsError
import librosa
import concurrent.futures

from feature_extraction import extract_features
from embedding import EmbeddingParams, build_embedding

def find_audio_files(s3_client, bucket_name, extensions=('*.wav', '*.mp3', '*.flac', '*.ogg')):
    audio_files = []

    paginator = s3_client.get_paginator('list_objects_v2')
    for result in paginator.paginate(Bucket=bucket_name):
        for content in result.get('Contents', []):
            key = content['Key']
            if any(fnmatch.fnmatch(key, ext) for ext in extensions):
                audio_files.append(key)

    return audio_files

def download_s3_files(s3_client, bucket_name, audio_files, cache_directory, max_workers=5):
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for key in audio_files:
            local_path = os.path.join(cache_directory, key)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            future = executor.submit(s3_client.download_file, bucket_name, key, local_path)
            futures.append(future)

        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except NoCredentialsError:
                print("Credentials not available")
                return

MAX_CONCURRENCY = int(os.environ.get("MAX_CONCURRENCY", 5))
"""Number of audio files to process at once"""
CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", 100))
S3_DOWNLOAD_CONCURRENCY = int(os.environ.get("S3_DOWNLOAD_CONCURRENCY", 5))
RETRY_ATTEMPTS = 3
RETRY_DELAY = 1  # in seconds
SERVICE_URL = os.environ.get("SERVICE_URL", "http://localhost:8080")


class S3Params(BaseModel):
    base_url: str
    access_key: str
    secret_key: str
    bucket_name: str

class ProcessRequest(BaseModel):
    s3_params: S3Params
    object_keys: List[str]
    feature_type: str = "both"
    fixed_length: int = 100
    stretch_and_fold: bool = True
    fft_size: int = 512
    embedding_params: EmbeddingParams
    max_files: int = 1000000

app = FastAPI()


async def process_audio_files(client: httpx.AsyncClient, process_request: ProcessRequest):
    try:
        response = await client.post(
            f"{SERVICE_URL}/process_files",
            json=process_request.dict(),
            timeout=httpx.Timeout(60, connect=20, read=600)
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        print(f"Request failed with status {e.response.status_code}: {e.response.text}")
        raise
    except httpx.RequestError as e:
        print(f"Request failed: {e}")
        raise


async def retry_process_audio_files(client: httpx.AsyncClient, process_request: ProcessRequest):
    for attempt in range(RETRY_ATTEMPTS):
        try:
            return await process_audio_files(client, process_request)
        except (httpx.RequestError, httpx.HTTPStatusError):
            await asyncio.sleep(RETRY_DELAY)
            continue
    print("Max retries reached, request failed.")
    raise HTTPException(status_code=500, detail="Max retries reached, request failed.")

async def process_audio_files_with_work_stealing(client: httpx.AsyncClient, process_requests: List[ProcessRequest]) -> List[List[float]]:
    """
    Given a list of requests to send, will send up to `MAX_CONCURRENCY` requests at once. Will retry individual requests up to 3 times
    if they fail, with a delay, but will return an error if any subrequest cannot complete. Returns flattened results in the order they
    were provided.
    """
    async def process_task(idx: int, req: ProcessRequest):
        result = await retry_process_audio_files(client, req)
        return idx, result

    queue = asyncio.Queue()
    for idx, req in enumerate(process_requests):
        await queue.put((idx, req))

    active_tasks = set()
    completed_results = {}

    while not queue.empty() or active_tasks:
        while len(active_tasks) < MAX_CONCURRENCY and not queue.empty():
            idx, req = await queue.get()
            task = asyncio.create_task(process_task(idx, req))
            active_tasks.add(task)

        done, pending = await asyncio.wait(active_tasks, return_when=asyncio.FIRST_COMPLETED)
        active_tasks -= done
        print(f"Completed {len(done)} tasks, {len(active_tasks)} tasks still running, {queue.qsize()} tasks still in queue")

        for task in done:
            idx, result = await task
            completed_results[idx] = result

    # Flatten the results and keep them in the correct order
    feature_vectors = [result for idx in sorted(completed_results.keys()) for result in completed_results[idx]]

    return feature_vectors

@app.post("/", response_class=JSONResponse)
async def create_embedding(request: Request, process_request: ProcessRequest):
    s3_params = process_request.s3_params
    s3_client = boto3.client(
        's3',
        endpoint_url=s3_params.base_url,
        aws_access_key_id=s3_params.access_key,
        aws_secret_access_key=s3_params.secret_key,
        config=Config(signature_version='s3v4')
    )

    # Find audio files in the S3 bucket
    audio_files = find_audio_files(s3_client, s3_params.bucket_name)
    audio_files = audio_files[:process_request.max_files]

    # Split audio files into chunks for parallel processing
    audio_chunks = [audio_files[i:i + CHUNK_SIZE] for i in range(0, len(audio_files), CHUNK_SIZE)]
    process_requests = [process_request.copy(update={'object_keys': chunk}) for chunk in audio_chunks]
    print(f"Need to process {len(audio_files)} audio files in {len(audio_chunks)} chunks")

    all_feature_vectors = []

    async with httpx.AsyncClient() as client:
        results = await process_audio_files_with_work_stealing(client, process_requests)
        all_feature_vectors.extend(results)

    try:
        embedding = build_embedding(all_feature_vectors, audio_files, process_request.embedding_params)
        return JSONResponse(content=embedding)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/process_files", response_class=JSONResponse)
async def process_files(request: Request, process_request: ProcessRequest):
    print(f"/process_files: processing {len(process_request.object_keys)} files")

    s3_client = boto3.client(
        's3',
        endpoint_url=process_request.s3_params.base_url,
        aws_access_key_id=process_request.s3_params.access_key,
        aws_secret_access_key=process_request.s3_params.secret_key,
        config=Config(signature_version='s3v4')
    )

    # Download audio files to a cache directory
    cache_directory = tempfile.mkdtemp(prefix="audio_cache_")
    download_s3_files(s3_client, process_request.s3_params.bucket_name, process_request.object_keys, cache_directory, S3_DOWNLOAD_CONCURRENCY)
    print(f"Downloaded {len(process_request.object_keys)} files to {cache_directory}. Starting feature extraction...")

    # Local file paths
    local_audio_files = [os.path.join(cache_directory, f) for f in process_request.object_keys]

    # Feature extraction
    feature_vectors = []
    try:
        for file in local_audio_files:
            try:
                y, sr = librosa.load(file)
                features = extract_features(y, sr, process_request.feature_type,
                                            process_request.fixed_length,
                                            process_request.stretch_and_fold,
                                            process_request.fft_size)
                feature_vectors.append(features)
            except Exception as e:
                print(f"Error processing file {file}: {e}")
                raise HTTPException(status_code=500, detail=f"Error processing file {file}")
    finally:
        # Clean up the cache directory
        shutil.rmtree(cache_directory)

    print(f"Successfully extracted features from all {len(process_request.object_keys)} files")

    # Need to convert from numpy to python types for JSON serialization
    feature_vectors = [f.tolist() for f in feature_vectors]

    return JSONResponse(content=feature_vectors)

@app.get("/test", response_class=JSONResponse)
async def test(request: Request):
    secret_key = os.environ.get("SECRET_KEY")
    host_base = os.environ.get("HOST_BASE")
    access_key = os.environ.get("ACCESS_KEY")
    bucket_name = os.environ.get("BUCKET_NAME")

    test_req = ProcessRequest(
        s3_params=S3Params(
            base_url=f"https://{host_base}",
            access_key=access_key,
            secret_key=secret_key,
            bucket_name=bucket_name
        ),
        object_keys=[],
        feature_type="both",
        embedding_params=EmbeddingParams(
            method="umap",
            n_neighbors=30,
        ),
        fixed_length=100,
        # max_files=10,
    )

    # make recursive call to the main endpoint
    return await create_embedding(request, test_req)
