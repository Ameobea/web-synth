package remoteSamples

import (
	"context"
	"io/ioutil"
	"log"
	"net/http"
	"os"

	"cloud.google.com/go/storage"
	"github.com/gorilla/mux"
)

type remoteSampleHandler struct {
	ctx                      context.Context
	googleCloudStorageClient *storage.Client
	authToken                string
}

const remoteSamplesBucketName = "web-synth-remote-samples"
const maxRequestSizeBytes = 1024 * 1024 * 100 // 100MB

func createRemoteSample(ctx remoteSampleHandler, id string, sample []byte) error {
	bucket := ctx.googleCloudStorageClient.Bucket(remoteSamplesBucketName)
	obj := bucket.Object(id)
	writer := obj.NewWriter(ctx.ctx)

	_, err := writer.Write(sample)
	if err != nil {
		return err
	}
	err = writer.Close()
	if err != nil {
		return err
	}

	return nil
}

func (ctx remoteSampleHandler) ServeHTTP(resWriter http.ResponseWriter, req *http.Request) {
	// Add CORS headers
	resWriter.Header().Set("Access-Control-Allow-Origin", "*")
	resWriter.Header().Set("Access-Control-Request-Method", "HEAD,GET,POST,PUT,PATCH,DELETE")

	queryParams := req.URL.Query()
	token := queryParams.Get("token")
	if token != ctx.authToken {
		resWriter.WriteHeader(403)
		resWriter.Write([]byte("Not Authorized"))
		return
	}

	vars := mux.Vars(req)
	id := vars["id"]
	req.Body = http.MaxBytesReader(resWriter, req.Body, maxRequestSizeBytes)
	body, err := ioutil.ReadAll(req.Body)
	if err != nil {
		log.Printf("Error reading body from create sample request: %s", err)
		resWriter.WriteHeader(500)
		resWriter.Write([]byte("Error reading body from request"))
		return
	}

	err = createRemoteSample(ctx, id, body)
	if err != nil {
		log.Printf("Error uploading sample to GCS: %s", err)
		resWriter.WriteHeader(500)
		resWriter.Write([]byte("Error storing data"))
		return
	}
}

// ServeRemoteSamplesRoutes serves the routes that deal with remote sample creation and management
func ServeRemoteSamplesRoutes(ctx context.Context, googleCloudStorageClient *storage.Client, router *mux.Router) {
	authToken := os.Getenv("AUTH_TOKEN")
	if authToken == "" {
		log.Println("ERROR: `AUTH_TOKEN` environment variable must be supplied")
		os.Exit(1)
	}
	handler := remoteSampleHandler{ctx, googleCloudStorageClient, authToken}

	subrouter := router.PathPrefix("/remote_samples").Subrouter()
	subrouter.Handle("/{id}", handler).Methods("POST")
}
