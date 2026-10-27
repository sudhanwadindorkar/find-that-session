import fs from "fs";
import { config } from "@/lib/config";

type FeatureExtractor = (
  texts: string[],
  options: {
    pooling: "mean";
    normalize: boolean;
  },
) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      fs.mkdirSync(config.transformersCacheDir, { recursive: true });
      process.env.TRANSFORMERS_CACHE = config.transformersCacheDir;
      // Avoid trying to use browser backends in Node
      process.env.TRANSFORMERS_OFFLINE =
        process.env.TRANSFORMERS_OFFLINE || "0";

      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = config.transformersCacheDir;
      env.allowLocalModels = true;

      const pipe = await pipeline("feature-extraction", config.embeddingModel, {
        // q8 is smaller/faster and avoids some fp32 onnx parse issues
        dtype: "q8",
      });

      return async (texts, options) => {
        const out = await pipe(texts, options);
        // transformers.js returns Tensor-like with .data
        const data = (out as { data: Float32Array | number[] }).data;
        return { data };
      };
    })();
  }
  return extractorPromise;
}

function toFloat32(data: Float32Array | number[], dims: number): Float32Array {
  if (data instanceof Float32Array && data.length === dims) return data;
  const arr = new Float32Array(dims);
  const len = Math.min(dims, data.length);
  for (let i = 0; i < len; i++) arr[i] = Number(data[i]);
  return arr;
}

export async function embedDocument(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const result = await extractor([text || " "], {
    pooling: "mean",
    normalize: true,
  });
  return toFloat32(result.data, config.embeddingDims);
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const prefixed = `${config.queryPrefix}${text || " "}`;
  const result = await extractor([prefixed], {
    pooling: "mean",
    normalize: true,
  });
  return toFloat32(result.data, config.embeddingDims);
}

export function float32ToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}
