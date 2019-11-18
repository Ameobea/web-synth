package main

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

	"cloud.google.com/go/storage"
	wasm "github.com/akupila/go-wasm"
)

type compileHandler struct {
	ctx                      context.Context
	googleCloudStorageClient *storage.Client
}

type faustWorkletModuleHandler struct {
	ctx                      context.Context
	googleCloudStorageClient *storage.Client
	faustCodeTemplate        *template.Template
}

func getFileSize(fileName string) (int64, error) {
	file, err := os.Open(fileName)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	fileStats, err := file.Stat()
	if err != nil {
		return 0, err
	}

	return fileStats.Size(), nil
}

func compile(srcFilePath string, outWasmFileName string) (stderr bytes.Buffer, err error) {
	// Compile the Faust code, producing an output wasm file as well as an output JS file
	cmd := exec.Command("faust", "-lang", "wasm", "-o", outWasmFileName, srcFilePath)

	var outb, errb bytes.Buffer
	cmd.Stdout = &outb
	cmd.Stderr = &errb

	err = cmd.Run()

	return errb, err
}

const compiledModuleBucketName = "web_synth-compiled_faust_modules_wasm"

func getObjectName(codeHash string, optimized bool, ext string) string {
	objectName := codeHash
	if optimized {
		objectName += "_optimized"
	}
	objectName += "."
	objectName += ext
	return objectName
}

func getModuleJSONObjectURL(id string) string {
	return "https://storage.googleapis.com/" + compiledModuleBucketName + "/" + id + ".json"
}

func getModuleURL(codeHash string, optimized bool) string {
	return "https://storage.googleapis.com/" + compiledModuleBucketName + "/" + getObjectName(codeHash, optimized, "wasm")
}

func (ctx compileHandler) addModuleToCache(moduleFileName string, codeHash string, optimized bool) error {
	defer os.Remove(moduleFileName)

	bkt := ctx.googleCloudStorageClient.Bucket(compiledModuleBucketName)
	wasmObjectName := getObjectName(codeHash, optimized, "wasm")
	obj := bkt.Object(wasmObjectName)
	wasmWriter := obj.NewWriter(ctx.ctx)
	defer wasmWriter.Close()

	fileHandle, err := os.Open(moduleFileName)
	if err != nil {
		return err
	}
	defer fileHandle.Close()

	if _, err := io.Copy(wasmWriter, fileHandle); err != nil {
		log.Printf("Error uploading Wasm module to google cloud storage: %s", err)
		return err
	}
	log.Printf("Successfully added Faust module %s to the compilation cache", wasmObjectName)

	// Wasm module added; now build + add JSON module def
	jsonModuleDef, err := readJSONModuleFromWasm(moduleFileName)
	if err != nil {
		log.Printf("Error while parsing generated Wasm module: %s", err)
		return err
	}

	jsonObjectName := getObjectName(codeHash, optimized, "json")
	obj = bkt.Object(jsonObjectName)
	jsonModuleWriter := obj.NewWriter(ctx.ctx)
	defer jsonModuleWriter.Close()

	_, err = jsonModuleWriter.Write(jsonModuleDef)
	if err != nil {
		log.Printf("Error uploading JSON module to google cloud storage: %s", err)
		return err
	}
	log.Printf("Successfully added JSON module def %s to the compilation cache", jsonObjectName)

	return nil
}

// checkCacheForModule checks to see if there exists an entry for the provided `codeHash`.  If it does
// exist, returns it.
func (ctx compileHandler) checkCacheForModule(codeHash string, optimize bool) ([]byte, error) {
	url := getModuleURL(codeHash, optimize)
	res, err := http.Get(url)
	if err != nil {
		return nil, err
	}

	if res.StatusCode == 404 {
		return nil, nil
	} else if res.StatusCode == 200 {
		return ioutil.ReadAll(res.Body)
	} else {
		log.Printf("Unexpected response code of %d while checking bucket", res.StatusCode)
		return nil, fmt.Errorf("Unexpected response code of %d while checking bucket", res.StatusCode)
	}
}

func readJSONModuleFromWasm(wasmFileName string) ([]byte, error) {
	fileHandle, err := os.Open(wasmFileName)
	if err != nil {
		return nil, err
	}
	defer fileHandle.Close()

	mod, err := wasm.Parse(fileHandle)
	if err != nil {
		return nil, err
	}

	// Read the JSON definition out of the "Data" section
	for _, genSection := range mod.Sections {
		switch section := genSection.(type) {
		case *wasm.SectionData:
			{
				// Copy all of the data out of the data segment into the buffer and return it
				var buf []byte
				for _, segment := range section.Entries {
					buf = append(buf, segment.Data...)
				}

				return buf, nil
			}
		}
	}

	return nil, fmt.Errorf("No section of type \"Data\" found in the generated Wasm module")
}

func hashFaustCode(faustCode []byte) string {
	hasher := sha1.New()
	hasher.Write(faustCode)
	return hex.EncodeToString(hasher.Sum(nil))
}

const faustModuleIDHeaderName = "X-Faust-Module-ID"

func (ctx compileHandler) ServeHTTP(resWriter http.ResponseWriter, req *http.Request) {
	// Add CORS headers
	resWriter.Header().Set("Access-Control-Allow-Origin", "*")
	resWriter.Header().Set("Access-Control-Allow-Headers", faustModuleIDHeaderName)

	if req.Method == "POST" {
		req.ParseMultipartForm(10e8)
	} else if req.Method == "HEAD" {
		resWriter.WriteHeader(204)
		return
	} else {
		resWriter.WriteHeader(405)
		resWriter.Write([]byte("You must send a POST request."))
		return
	}

	uploadedFile, _, err := req.FormFile("code.faust")
	if err != nil {
		log.Printf("No file `code.faust` provided with request")
		resWriter.WriteHeader(400)
		log.Println(err)
		return
	}
	defer uploadedFile.Close()

	optimize := len(req.FormValue("optimize")) > 0

	// Hash the uploaded Faust code and check to see if we have a pre-compiled module for it.
	uploadedFileBytes, err := ioutil.ReadAll(uploadedFile)
	if err != nil {
		log.Printf("Error while read reading uploaded Faust code from request: %s", err)
		http.Error(resWriter, "Error while read reading uploaded Faust code from request", 500)
		return
	}

	digest := hashFaustCode(uploadedFileBytes)
	precompiledModule, err := ctx.checkCacheForModule(digest, optimize)
	if err != nil {
		log.Printf("Error while checking cache for existing compiled module: %s", err)
		http.Error(resWriter, "Error while checking cache for existing compiled module", 500)
		return
	}

	// Add header containing the module ID to load the Faust Worklet Processor code for the compiled module
	moduleID := digest
	if optimize {
		moduleID += "_optimize"
	}
	resWriter.Header().Set(faustModuleIDHeaderName, moduleID)

	if precompiledModule != nil {
		log.Printf("Found pre-compiled entry for module %s; using that.", digest)
		// We have an existing pre-compiled module so we just use that.
		_, err = resWriter.Write(precompiledModule)
		if err != nil {
			log.Printf("Error while writing pre-compiled module to response: %s", err)
			http.Error(resWriter, "Error while writing pre-compiled module to response", 500)
		}
		return
	}

	// Create a temporary file for the input source code
	srctmpfile, err := ioutil.TempFile("", "faust-code")
	if err != nil {
		log.Println(err)
		http.Error(resWriter, "Error creating temporary file", 500)
		return
	}
	srcFileName := srctmpfile.Name()
	defer os.Remove(srcFileName)

	// Create a temporary file for the output Wasm file
	dsttempfile, err := ioutil.TempFile("", "wasm-output")
	if err != nil {
		log.Println(err)
		errMsg := "Error creating temporary file"
		http.Error(resWriter, errMsg, 500)
		resWriter.Write([]byte(errMsg))
		return
	}
	tmpFileBaseName := dsttempfile.Name()
	defer os.Remove(tmpFileBaseName)

	// Copy the uploaded file to the tempfile
	io.Copy(srctmpfile, bytes.NewBuffer(uploadedFileBytes))

	// Compile the tempfile into WebAssembly
	outWasmFileName := fmt.Sprintf("%s.wasm", tmpFileBaseName)
	stderr, err := compile(srcFileName, outWasmFileName)
	if err != nil {
		log.Printf("Error while compiling Faust module: %s", err)
		resWriter.WriteHeader(400)
		resWriter.Write(stderr.Bytes())
		return
	}

	// Optimize the generated Wasm file if the `optimize` flag was set in the request body
	if optimize {
		log.Println("Executing `wasm-opt`...")

		fileBeforeSize, err := getFileSize(outWasmFileName)
		if err != nil {
			resWriter.WriteHeader(400)
			resWriter.Write([]byte("Failed to compute initial file size of output Wasm file"))
			return
		}

		cmd := exec.Command("wasm-opt", outWasmFileName, "-O4", "-c", "--vacuum", "-o", outWasmFileName)
		optError := cmd.Run()
		if optError != nil {
			log.Printf("Error while trying to optimize output Wasm file: %s", optError)
		} else {
			fileAfterSize, err := getFileSize(outWasmFileName)
			if err != nil {
				resWriter.WriteHeader(400)
				resWriter.Write([]byte("Failed to compute post-optimization file size of output Wasm file"))
				return
			}

			log.Printf("Successfully optimized output Wasm file: %d bytes -> %d bytes", fileBeforeSize, fileAfterSize)
		}
	}

	// Save it to the compilation cache asynchronously
	go ctx.addModuleToCache(outWasmFileName, digest, optimize)

	// Send the file back to the user
	http.ServeFile(resWriter, req, outWasmFileName)
}

func (ctx faustWorkletModuleHandler) buildFaustWorkletCode(jsonModuleDef []byte) ([]byte, error) {
	type TemplateArgs struct {
		JSONModuleDef string
	}

	var buf bytes.Buffer
	err := ctx.faustCodeTemplate.Execute(&buf, TemplateArgs{JSONModuleDef: string(jsonModuleDef)})
	if err != nil {
		log.Printf("Error while generating templated JS code: %s", err)
		return nil, err
	}

	return buf.Bytes(), nil
}

func (ctx faustWorkletModuleHandler) ServeHTTP(resWriter http.ResponseWriter, req *http.Request) {
	// Add CORS headers
	resWriter.Header().Set("Access-Control-Allow-Origin", "*")

	queryParams := req.URL.Query()
	moduleID := queryParams.Get("id")
	if moduleID == "" {
		http.Error(resWriter, "You must supply an `id` query param containing ID of the Faust module to fetch.", 500)
		return
	}

	url := getModuleJSONObjectURL(moduleID)
	res, err := http.Get(url)
	if err != nil {
		http.Error(resWriter, "Failed to fetch JSON module from compilation cache", 500)
		return
	} else if res.StatusCode != 200 {
		http.Error(resWriter, "Got non-200 status code while retrieving JSON module definition; status code %d", res.StatusCode)
		return
	}

	jsonModuleDef, err := ioutil.ReadAll(res.Body)
	if err != nil {
		http.Error(resWriter, "Error reading JSON module def into buffer", 500)
		return
	}

	// Build the JavaScript code for the Faust Worklet Processor using the JSON module retrieved from the cache
	jsCode, err := ctx.buildFaustWorkletCode(jsonModuleDef)
	if err != nil {
		http.Error(resWriter, "Error while building Faust worklet processor code via template", 500)
		return
	}

	_, err = resWriter.Write(jsCode)
	if err != nil {
		http.Error(resWriter, "Error writing Faust module code into response body", 500)
		return
	}

	res.Header.Set("Content-Type", "text/javascript")
}

func main() {
	ctx := context.Background()
	client, err := storage.NewClient(ctx)
	if err != nil {
		log.Fatalf("Failed to create Google Cloud Storage client: %s", err)
	}

	compileHandlerInst := compileHandler{
		ctx:                      ctx,
		googleCloudStorageClient: client,
	}
	http.Handle("/compile", compileHandlerInst)

	faustWorkletTemplateFileName := os.Getenv("FAUST_WORKLET_TEMPLATE_FILE_NAME")
	if faustWorkletTemplateFileName == "" {
		log.Fatalf("Error: `FAUST_WORKLET_TEMPLATE_FILE_NAME` must be provided.")
	}
	fileHandle, err := os.Open(faustWorkletTemplateFileName)
	if err != nil {
		log.Fatalf("Error while opening Faust worklet template filename at %s: %s", faustWorkletTemplateFileName, err)
	}
	faustWorkletCodeTemplateBody, err := ioutil.ReadAll(fileHandle)
	if err != nil {
		log.Fatalf("Error while reading Faust worklet template file: %s", err)
	}

	faustCodeTemplate, err := template.New("Faust Worklet Processor JavaScript Code").Parse(string(faustWorkletCodeTemplateBody))
	if err != nil {
		log.Fatalf("Error while parsing Faust worklet template file: %s", err)
	}

	faustWorkletModuleHandlerInst := faustWorkletModuleHandler{
		ctx:                      ctx,
		googleCloudStorageClient: client,
		faustCodeTemplate:        faustCodeTemplate,
	}
	http.Handle("/FaustWorkletProcessor.js", faustWorkletModuleHandlerInst)

	port := os.Getenv("PORT")
	if len(port) == 0 {
		port = "4565"
	}

	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatalf("Error listening on port: %s", err)
	}
}
