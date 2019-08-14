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

	// Create a temporary file for the input source code
	srctmpfile, err := ioutil.TempFile("", "faust-code")
	if err != nil {
		fmt.Println(err)
		http.Error(resWriter, "Error creating temporary file", 500)
		return
	}

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
	outWasmFileName := fmt.Sprintf("%s.wasm", tmpFileBaseName)

	// Copy the uploaded file to the tempfile
	io.Copy(srctmpfile, uploadedFile)

	// Compile the tempfile into WebAssembly
	stderr, err := compile(srctmpfile.Name(), outWasmFileName)

	if err != nil {
		resWriter.WriteHeader(400)
		resWriter.Write(stderr.Bytes())
		return
	}

	// Send the file back to the user
	http.ServeFile(resWriter, req, outWasmFileName)

	// Clean up the tempfiles
	os.Remove(outWasmFileName)
	os.Remove(tmpFileBaseName)
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
