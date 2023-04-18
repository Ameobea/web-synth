import json
import emblaze
from emblaze import Field, ProjectionTechnique
import os
from typing import List
from pydantic import BaseModel


class EmbeddingParams(BaseModel):
    method: str
    perplexity: int = None
    learning_rate: str = 'auto'
    init: str = 'pca'
    early_exaggeration: float = 1.3
    n_neighbors: int = None
    min_dist: float = 0.2
    metric: str = 'euclidean'


def colorize(sample_name: str):
    lower_sample_name = sample_name.lower()
    if 'vocal' in lower_sample_name:
        return 'vocal'
    elif 'kick' in lower_sample_name:
        return 'kick'
    elif 'snare' in lower_sample_name:
        return 'snare'
    elif 'fx' in lower_sample_name:
        return 'fx'
    elif 'perc' in lower_sample_name:
        return 'perc'
    elif 'hat' in lower_sample_name:
        return 'hat'
    else:
        return 'other'


def build_embedding(features_scaled, audio_files, embedding_params: EmbeddingParams):
    positions = features_scaled
    names = [os.path.splitext(os.path.basename(file))[0] for file in audio_files]
    colors = [colorize(name) for name in names]
    sizes = [1 for _ in range(len(features_scaled))]

    # Need to clamp n_neighbors to the number of samples
    if embedding_params.n_neighbors is None:
        embedding_params.n_neighbors = min(20, len(features_scaled))
    else:
        embedding_params.n_neighbors = min(embedding_params.n_neighbors, len(features_scaled))

    emb_params = {
        Field.POSITION: positions,
        Field.NAME: names,
        Field.COLOR: colors,
        Field.RADIUS: sizes
    }
    emb = emblaze.Embedding(emb_params, n_neighbors=min(20, len(features_scaled) - 2))
    emb.compute_neighbors(metric='euclidean')

    print(f"Generating {embedding_params.method} embedding... of {len(features_scaled)} samples")
    print(embedding_params)

    if embedding_params.method.lower() == 'tsne':
        projection = emb.project(method=ProjectionTechnique.TSNE,
                                 perplexity=embedding_params.perplexity,
                                 learning_rate=embedding_params.learning_rate,
                                 init=embedding_params.init,
                                 early_exaggeration=embedding_params.early_exaggeration)
    elif embedding_params.method.lower() == 'umap':
        projection = emb.project(method=ProjectionTechnique.UMAP,
                                 n_neighbors=embedding_params.n_neighbors,
                                 min_dist=embedding_params.min_dist,
                                 metric=embedding_params.metric)
    else:
        raise ValueError("Invalid embedding method provided.")

    print("Successfully generated embedding")

    serialized = projection.to_json(compressed=False, save_neighbors=False)
    neighbors_json = emb.get_neighbors().to_json(compressed=False)
    neighbors_json['neighbors'] = {int(key): value for (key, value) in neighbors_json['neighbors'].items()}
    serialized['neighbors'] = neighbors_json
    serialized['names'] = audio_files

    return serialized
