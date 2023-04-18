interface Neighbors {
  metric: string;
  n_neighbors: number;
  /**
   * sample_ix: list of neighbor sample_ix
   */
  neighbors: Record<string, number[]>;
}

export interface AudioSampleEmbeddingDatum {
  x: number;
  y: number;
  color: string;
  r: number;
}

export interface AudioSampleEmbedding {
  /**
   * sample_ix: embedded point
   */
  points: Record<string, AudioSampleEmbeddingDatum>;
  metric: string;
  n_neighbors: number;
  neighbors: Neighbors;
  names: string[];
}

export interface AudioSampleEmbeddingSampleClickData extends AudioSampleEmbeddingDatum {
  sampleName: string;
}
