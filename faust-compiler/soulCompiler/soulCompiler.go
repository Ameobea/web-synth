package soulCompiler

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"text/template"
	"time"

	"cloud.google.com/go/storage"
	compilationFileUtils "github.com/ameobea/web-synth/faust-compiler-server/compilationFileUtils"
	"github.com/gorilla/mux"
	wasmer "github.com/wasmerio/wasmer-go/wasmer"
)

type soulCompileHandler struct {
	ctx                      context.Context
	googleCloudStorageClient *storage.Client
}

const compiledSoulWasmBucketName = "web_synth_compiled_soul_wasm"
const maxRequestSizeBytes = 1024 * 1024 // 1MB

func readJSONDefFromWasm(fileHandle *os.File) ([]byte, error) {
	wasmBytes := bytes.NewBuffer(nil)
	_, err := io.Copy(wasmBytes, fileHandle)
	if err != nil {
		log.Printf("Error reading output Wasm file: %s", err)
		return nil, err
	}

	// Instantiates the WebAssembly module.
	engine := wasmer.NewEngine()
	store := wasmer.NewStore(engine)
	module, err := wasmer.NewModule(store, wasmBytes.Bytes())
	if err != nil {
		log.Printf("Error instantiating WebAssembly module: %s", err)
		return nil, err
	}
	instance, _ := wasmer.NewInstance(module, wasmer.NewImportObject())

	// Close the WebAssembly instance later.
	defer instance.Close()

	// Gets the `sum` exported function from the WebAssembly instance.
	getDescription, err := instance.Exports.GetFunction("getDescription")
	if err != nil {
		log.Printf("Error getting getDescription function: %s", err)
		return nil, err
	}
	getDescriptionLength, err := instance.Exports.GetFunction("getDescriptionLength")
	if err != nil {
		log.Printf("Error getting getDescriptionLength function: %s", err)
		return nil, err
	}

	descriptionPtrVal, err := getDescription()
	if err != nil {
		log.Printf("Error getting description ptr from Wasm: %s", err)
		return nil, err
	}
	descriptionPtr := descriptionPtrVal.(int32)

	descriptionLenVal, err := getDescriptionLength()
	if err != nil {
		log.Printf("Error getting description length from Wasm: %s", err)
		return nil, err
	}
	descriptionLen := descriptionLenVal.(int32)

	memory, err := instance.Exports.GetMemory("memory")
	if err != nil {
		log.Printf("Error getting memory from Wasm: %s", err)
		return nil, err
	}

	jsonDef := memory.Data()[descriptionPtr:(descriptionPtr + descriptionLen)]
	log.Printf("Successfully read JSON def out of Wasm")
	jsonDefClone := make([]byte, len(jsonDef))
	// Things segfault if I don't do this :shrug:
	copy(jsonDefClone, jsonDef)
	return jsonDefClone, nil
}

func hashSoulCode(soulCode []byte) string {
	hasher := sha1.New()
	hasher.Write(soulCode)
	return hex.EncodeToString(hasher.Sum(nil))
}

func getModuleURL(codeHash string) string {
	return "https://storage.googleapis.com/" + compiledSoulWasmBucketName + "/" + codeHash + ".wasm"
}

func checkCacheForModule(codeHash string) ([]byte, error) {
	url := getModuleURL(codeHash)
	res, err := http.Get(url)
	if err != nil {
		return nil, err
	}

	if res.StatusCode == 404 {
		return nil, nil
	} else if res.StatusCode == 200 {
		log.Printf("Cache hit for Soul module %s", codeHash)
		return ioutil.ReadAll(res.Body)
	} else {
		log.Printf("Unexpected response code of %d while checking bucket", res.StatusCode)
		return nil, fmt.Errorf("Unexpected response code of %d while checking bucket", res.StatusCode)
	}
}

func (ctx soulCompileHandler) cacheSoulModule(codeHash string, wasmFileName string) error {
	wasmFile, err := os.Open(wasmFileName)
	if err != nil {
		log.Printf("Error opening soul wasm output file: %s", err)
		return err
	}
	defer wasmFile.Close()

	bkt := ctx.googleCloudStorageClient.Bucket(compiledSoulWasmBucketName)
	obj := bkt.Object(codeHash + ".wasm")
	wasmWriter := obj.NewWriter(ctx.ctx)
	wasmWriter.ContentType = "application/wasm"

	bytesWritten, err := io.Copy(wasmWriter, wasmFile)
	if err != nil {
		log.Printf("Error uploading soul module Wasm module to google cloud storage: %s", err)
		return err
	}
	log.Printf("Successfully wrote %d bytes of Soul Wasm module %s to the compilation cache", bytesWritten, codeHash)
	err = wasmWriter.Close()
	if err != nil {
		log.Printf("Error closing GCS object writer for object %s: %s", wasmWriter.Name, err)
	}

	wasmFile.Seek(0, 0)
	jsonDef, err := readJSONDefFromWasm(wasmFile)
	if err != nil {
		log.Printf("Error loading JSON def out of compiled Soul module: %s", err)
		return err
	}

	obj = bkt.Object(codeHash + ".json")
	jsonWriter := obj.NewWriter(ctx.ctx)
	jsonWriter.ContentType = "application/json"
	jsonBytesWritten, err := jsonWriter.Write(jsonDef)
	if err != nil {
		log.Printf("Error uploading soul module json module definition to google cloud storage: %s", err)
		return err
	}
	log.Printf("Successfully wrote %d bytes of Soul JSON module definition %s to the compilation cache", jsonBytesWritten, codeHash)
	err = jsonWriter.Close()
	if err != nil {
		log.Printf("Error closing GCS object writer for object %s: %s", jsonWriter.Name, err)
	}

	return nil
}

// Compiles the provided soul code and returns the name of the file containing the compiled Wasm if successful
func compileSoulModule(srcFilePath string) (string, bytes.Buffer, error) {
	var outb, errb bytes.Buffer

	dsttmpfile, err := ioutil.TempFile("", "soul-wasm")
	if err != nil {
		log.Printf("Error creating tempfile for soul output wasm: %s", err)
		return "", errb, err
	}

	outFileName := dsttmpfile.Name()
	cmd := exec.Command("soul", "generate", "--wasm", "--output="+outFileName, srcFilePath)

	cmd.Stdout = &outb
	cmd.Stderr = &errb

	err = cmd.Run()
	return outFileName, errb, err
}

// Compiles the provided soul source code, checking the cache first and returning the
func (ctx soulCompileHandler) compileSoul(soulCodeData []byte, req *http.Request, resWriter http.ResponseWriter) {
	digest := hashSoulCode(soulCodeData)
	resWriter.Header().Set(soulModuleIDHeaderName, digest)

	// First check the cache to see if we already have a compiled copy of this
	cachedModule, err := checkCacheForModule(digest)
	if cachedModule != nil {
		if _, err = resWriter.Write(cachedModule); err != nil {
			log.Printf("Error writing cached module to response: %s", err)
			http.Error(resWriter, "Error writing response to you for some reason", 500)
		}
		return
	}
	if err != nil {
		log.Printf("Error checking for cached soul module hash %s, falling back to compilation", digest)
	}

	// Write the soul source code to a tempfile
	srctmpfile, err := ioutil.TempFile("", "soul-code")
	if err != nil {
		log.Printf("Error creating tempfile for soul source code: %s", err)
		http.Error(resWriter, "Error creating tempfile for soul source code", 500)
		return
	}
	defer srctmpfile.Close()
	if _, err = srctmpfile.Write(soulCodeData); err != nil {
		log.Printf("Error writing soul code to tempfile: %s", err)
		http.Error(resWriter, "Error writing soul code to tempfile", 500)
		return
	}

	outFileName, stderr, err := compileSoulModule(srctmpfile.Name())
	if err != nil {
		log.Printf("Error compiling soul code for module %s: %s", digest, err)
		resWriter.WriteHeader(400)
		output := stderr.Bytes()
		log.Printf("%s", output)
		if _, err = resWriter.Write(output); err != nil {
			log.Printf("Error writing stderr to user: %s", err)
			http.Error(resWriter, "Error writing stderr to you", 500)
		}
		return
	}

	// Compilation was successful!  Cache the module for the future
	log.Printf("Successfully compiled soul module; optimizing...")
	optSuccess := compilationFileUtils.WasmOptFile(outFileName, resWriter)
	if !optSuccess {
		return
	}

	// Asynchronously store the compiled module in the cache
	go ctx.cacheSoulModule(digest, outFileName)

	resWriter.Header().Set("Content-Type", "application/wasm")
	http.ServeFile(resWriter, req, outFileName)
}

const soulModuleIDHeaderName = "X-Soul-Module-ID"

func (ctx soulCompileHandler) ServeHTTP(resWriter http.ResponseWriter, req *http.Request) {
	// Add CORS headers
	resWriter.Header().Set("Access-Control-Allow-Origin", "*")
	resWriter.Header().Set("Access-Control-Expose-Headers", soulModuleIDHeaderName)
	resWriter.Header().Set("Access-Control-Request-Method", "HEAD,GET,POST,PUT,PATCH,DELETE")

	req.Body = http.MaxBytesReader(resWriter, req.Body, maxRequestSizeBytes)
	body, err := ioutil.ReadAll(req.Body)
	if err != nil {
		log.Printf("Error reading body from soul compile request: %s", err)
		resWriter.WriteHeader(500)
		resWriter.Write([]byte("Error reading body from request"))
		return
	}

	ctx.compileSoul(body, req, resWriter)
}

type soulAwpHandler struct {
	ctx                      context.Context
	googleCloudStorageClient *storage.Client
	awpCodeTemplate          *template.Template
}

func (ctx soulAwpHandler) buildSoulAWPCode(jsonModuleDef []byte, moduleID string) ([]byte, error) {
	type TemplateArgs struct {
		JSONModuleDef string
		ModuleID      string
	}

	var buf bytes.Buffer
	err := ctx.awpCodeTemplate.Execute(&buf, TemplateArgs{JSONModuleDef: string(jsonModuleDef), ModuleID: moduleID})
	if err != nil {
		log.Printf("Error while generating templated JS code: %s", err)
		return nil, err
	}

	return buf.Bytes(), nil
}

func (ctx soulAwpHandler) loadCachedModuleJSON(moduleID string, resWriter http.ResponseWriter) []byte {
	url := "https://storage.googleapis.com/" + compiledSoulWasmBucketName + "/" + moduleID + ".json"

	// try a few times to load the JSON since sometimes it can take a bit for the write to GCS to show up
	var resBody io.ReadCloser = nil
	for i := 0; i < 5; i++ {
		res, err := http.Get(url)
		if err != nil {
			if res == nil {
				log.Printf("Error making request to fetch Soul JSON module def: %s", err)
			} else {
				log.Printf("Failed to retrieve soul JSON module definition id %s; status code %d", moduleID, res.StatusCode)
			}
		} else if res.StatusCode != 200 {
			log.Printf("Got non-200 status code while retrieving JSON module definition id %s; status code %d", moduleID, res.StatusCode)
		} else {
			resBody = res.Body
			break
		}

		time.Sleep(500 * time.Millisecond)
	}
	if resBody == nil {
		log.Printf("Failed to fetch soul module JSON def in 5 attempts")
		http.Error(resWriter, "Failed to fetch the json definition for module in 5 attempts", 404)
		return nil
	}

	jsonModuleDef, err := ioutil.ReadAll(resBody)
	if err != nil {
		log.Printf("Error reading JSON module def into buffer: %v", err)
		http.Error(resWriter, "Error reading JSON module def into buffer", 500)
		return nil
	}

	return jsonModuleDef
}

func (ctx soulAwpHandler) ServeHTTP(resWriter http.ResponseWriter, req *http.Request) {
	// Add CORS headers
	resWriter.Header().Set("Access-Control-Allow-Origin", "*")
	resWriter.Header().Set("Access-Control-Request-Method", "HEAD,GET,POST,PUT,PATCH,DELETE")

	// Handle CORS preflight requests
	if req.Method == "HEAD" {
		resWriter.WriteHeader(204)
		return
	}

	queryParams := req.URL.Query()
	moduleID := queryParams.Get("id")
	if moduleID == "" {
		http.Error(resWriter, "Missing `id` param", 404)
		return
	}

	jsonDef := ctx.loadCachedModuleJSON(moduleID, resWriter)
	if jsonDef == nil {
		return
	}

	// Build the JavaScript code for the Faust Worklet Processor using the JSON module retrieved from the cache
	jsCode, err := ctx.buildSoulAWPCode(jsonDef, moduleID)

	// Add correct `Content-Type` header so that it's correctly loaded
	resWriter.Header().Set("Content-Type", "text/javascript")

	_, err = resWriter.Write(jsCode)
	if err != nil {
		log.Printf("Error writing Soul AWP code into response body: %v", err)
		http.Error(resWriter, "Error writing Soul module AWP code into response body", 500)
		return
	}
}

// ServeSoulCompilerRoutes mounts and serves the routes for compiling Soul code and retrieving the compiled Wasm + AWP code
func ServeSoulCompilerRoutes(ctx context.Context, googleCloudStorageClient *storage.Client, router *mux.Router) {
	handler := soulCompileHandler{ctx, googleCloudStorageClient}

	soulWorkletTemplateFileName := os.Getenv("SOUL_WORKLET_TEMPLATE_FILE_NAME")
	if soulWorkletTemplateFileName == "" {
		log.Fatalf("Error: `SOUL_WORKLET_TEMPLATE_FILE_NAME` must be provided.")
	}
	soulWorkletCodeTemplateBody, err := ioutil.ReadFile(soulWorkletTemplateFileName)
	if err != nil {
		log.Fatalf("Error while reading Soul worklet template file: %s", err)
	}
	awpCodeTemplate, err := template.New("Soul Worklet Processor JavaScript Code").Parse(string(soulWorkletCodeTemplateBody))
	if err != nil {
		log.Fatalf("Error loading the Soul AWP template: %s", err)
	}
	if awpCodeTemplate == nil {
		log.Fatalf("Error loading the Soul AWP template, but no err (template nil)")
	}

	awpHandler := soulAwpHandler{ctx, googleCloudStorageClient, awpCodeTemplate}

	subrouter := router.PathPrefix("/soul").Subrouter()
	subrouter.Handle("/compile", handler).Methods("POST")
	subrouter.Handle("/SoulAWP.js", awpHandler).Methods("GET")
}
