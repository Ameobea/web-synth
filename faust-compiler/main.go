package main

import (
	"bytes"
	"fmt"
	"io"
	"io/ioutil"
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

func compile(srcFilePath string, outWasmFileName string) (stderr bytes.Buffer, err error) {
	// Compile the Faust code, producing an output wasm file as well as an output JS file
	cmd := exec.Command("faust", "-lang", "wasm", "-o", outWasmFileName, srcFilePath)

	var outb, errb bytes.Buffer
	cmd.Stdout = &outb
	cmd.Stderr = &errb

	err = cmd.Run()

	return errb, err
}

func handleCompile(resWriter http.ResponseWriter, req *http.Request) {
	// Add CORS headers
	resWriter.Header().Set("Access-Control-Allow-Origin", "*")

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
		resWriter.WriteHeader(400)
		fmt.Println(err)
		return
	}
	defer uploadedFile.Close()

	optimize := len(req.FormValue("optimize")) > 0

	// Create a temporary file for the input source code
	srctmpfile, err := ioutil.TempFile("", "faust-code")
	if err != nil {
		fmt.Println(err)
		http.Error(resWriter, "Error creating temporary file", 500)
		return
	}
	srcFileName := srctmpfile.Name()
	defer os.Remove(srcFileName)

	// Create a temporary file for the output Wasm file
	dsttempfile, err := ioutil.TempFile("", "wasm-output")
	if err != nil {
		fmt.Println(err)
		errMsg := "Error creating temporary file"
		http.Error(resWriter, errMsg, 500)
		resWriter.Write([]byte(errMsg))
		return
	}
	tmpFileBaseName := dsttempfile.Name()
	defer os.Remove(tmpFileBaseName)

	// Copy the uploaded file to the tempfile
	io.Copy(srctmpfile, uploadedFile)

	// Compile the tempfile into WebAssembly
	outWasmFileName := fmt.Sprintf("%s.wasm", tmpFileBaseName)
	stderr, err := compile(srcFileName, outWasmFileName)
	if err != nil {
		resWriter.WriteHeader(400)
		resWriter.Write(stderr.Bytes())
		return
	}
	defer os.Remove(outWasmFileName)

	// Optimize the generated Wasm file if the `optimize` flag was set in the request body
	if optimize {
		fmt.Println("Executing `wasm-opt`...")

		fileBeforeSize, err := getFileSize(outWasmFileName)
		if err != nil {
			resWriter.WriteHeader(400)
			resWriter.Write([]byte("Failed to compute initial file size of output Wasm file"))
			return
		}

		cmd := exec.Command("wasm-opt", outWasmFileName, "-O4", "-c", "--vacuum", "-o", outWasmFileName)
		optError := cmd.Run()
		if optError != nil {
			fmt.Println("Error while trying to optimize output Wasm file:")
			fmt.Println(optError)
		} else {
			fileAfterSize, err := getFileSize(outWasmFileName)
			if err != nil {
				resWriter.WriteHeader(400)
				resWriter.Write([]byte("Failed to compute post-optimization file size of output Wasm file"))
				return
			}

			fmt.Printf("Successfully optimized output Wasm file: %d bytes -> %d bytes", fileBeforeSize, fileAfterSize)
		}
	}

	// Send the file back to the user
	http.ServeFile(resWriter, req, outWasmFileName)
}

func main() {
	http.HandleFunc("/compile", handleCompile)

	var port = os.Getenv("PORT")
	if len(port) == 0 {
		port = "4565"
	}

	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		fmt.Println("Error listening on port", err)
	}
}
