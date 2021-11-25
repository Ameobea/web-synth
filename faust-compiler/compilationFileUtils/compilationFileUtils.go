package compilationFileUtils

import (
	"log"
	"net/http"
	"os"
	"os/exec"
)

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

// WasmOptFile runs `wasm-opt` on `outWasmFileName` and writes the optimized file in-place.  It returns
// a boolean `true` if successfully optimized file in-place `false` if there was an error and the error
// was written to the `resWriter`.
func WasmOptFile(outWasmFileName string, resWriter http.ResponseWriter) bool {
	log.Println("Executing `wasm-opt`...")

	fileBeforeSize, err := getFileSize(outWasmFileName)
	if err != nil {
		resWriter.WriteHeader(400)
		resWriter.Write([]byte("Failed to compute initial file size of output Wasm file"))
		return false
	}

	cmd := exec.Command("wasm-opt", outWasmFileName, "-O4", "-c", "--vacuum", "-o", outWasmFileName)
	out, optError := cmd.CombinedOutput()
	if optError != nil {
		log.Printf("Error while trying to optimize output Wasm file: out=%s; err=%s", out, optError)
		resWriter.WriteHeader(500)
		resWriter.Write([]byte("Error optimizing output soul Wasm module"))
		return false
	} else {
		fileAfterSize, err := getFileSize(outWasmFileName)
		if err != nil {
			resWriter.WriteHeader(400)
			resWriter.Write([]byte("Failed to compute post-optimization file size of output Wasm file"))
			return false
		}

		log.Printf("Successfully optimized output Wasm file: %d bytes -> %d bytes", fileBeforeSize, fileAfterSize)
		return true
	}
}
