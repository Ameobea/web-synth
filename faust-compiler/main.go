package main

import (
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os/exec"
)

func compile(srcFilePath string, dstFilePath string) (err error) {
	_, err = exec.Command("faust", "-lang", "wasm", "-o", dstFilePath, srcFilePath).Output()

	if err != nil {
		return err
	}

	return nil
}

func handleCompile(resWriter http.ResponseWriter, req *http.Request) {
	resWriter.Header().Set("Access-Control-Allow-Origin", "*")

	if req.Method == "POST" {
		req.ParseMultipartForm(10e8)
	} else if req.Method == "HEAD" {
		resWriter.WriteHeader(200)
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
		http.Error(resWriter, "Error creating temporary file", 500)
		return
	}

	// Copy the uploaded file to the tempfile
	io.Copy(srctmpfile, uploadedFile)

	// Compile the tempfile into WebAssembly
	err = compile(srctmpfile.Name(), dsttempfile.Name())

	if err != nil {
		resWriter.WriteHeader(400)
		fmt.Println(err)
		return
	}

	// Send the file back to the user
	http.ServeFile(resWriter, req, dsttempfile.Name())
}

func main() {
	http.HandleFunc("/compile", handleCompile)

	http.ListenAndServe(":4565", nil)
}
