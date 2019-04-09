package main

import (
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os/exec"
)

func compile(tempFilePath string) (wasmOutput []byte, err error) {
	out, err := exec.Command("faust", "-lang", "wasm", tempFilePath).Output()

	if err != nil {
		return []byte(""), err
	}

	return out, nil
}

func handleCompile(resWriter http.ResponseWriter, req *http.Request) {
	if req.Method == "POST" {
		req.ParseMultipartForm(10e8)
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

	// Create a temporary file
	tmpfile, err := ioutil.TempFile("", "faust-code")
	if err != nil {
		fmt.Println(err)
		http.Error(resWriter, "Error creating temporary file", 500)
		return
	}

	// Copy the uploaded file to the tempfile
	io.Copy(tmpfile, uploadedFile)

	// Compile the tempfile into WebAssembly
	wasmFileContent, err := compile(tmpfile.Name())

	if err != nil {
		resWriter.WriteHeader(400)
		fmt.Println(err)
		return
	}

	resWriter.WriteHeader(200)
	resWriter.Write(wasmFileContent)
}

func main() {
	http.HandleFunc("/compile", handleCompile)

	http.ListenAndServe(":4565", nil)
}
