interface LayerInfo {
  name: string;
  shape: number[];
  offset: number;
}

export interface ModelMetrics {
  recall_at_1pct_false_alarms: number;
  recall_below_1px_shift: number;
  median_shift_error_px: number;
  threshold: number;
  star_pairs: number;
  fields: number;
  held_out_pairs: number;
  stamp: number;
  layers: LayerInfo[];
}

export interface MoverModel {
  metrics: ModelMetrics;
  predict: (input: Float32Array) => [number, number, number];
}

interface Tensor {
  data: Float32Array;
  channels: number;
  size: number;
}

let modelPromise: Promise<MoverModel> | null = null;

export function loadMoverModel(): Promise<MoverModel> {
  modelPromise ??= (async () => {
    const [metricsResponse, weightsResponse] = await Promise.all([fetch("/model/metrics.json"), fetch("/model/movernet.bin")]);
    if (!metricsResponse.ok || !weightsResponse.ok) throw new Error("The mover detector could not be loaded.");
    const metrics = (await metricsResponse.json()) as ModelMetrics;
    const weights = new Float32Array(await weightsResponse.arrayBuffer());
    const layer = (name: string) => {
      const info = metrics.layers.find((l) => l.name === name);
      if (!info) throw new Error(`Model file is missing ${name}`);
      const length = info.shape.reduce((p, q) => p * q, 1);
      return { values: weights.subarray(info.offset, info.offset + length), shape: info.shape };
    };
    const convs = [0, 2, 5].map((i) => ({ weight: layer(`features.${i}.weight`), bias: layer(`features.${i}.bias`) }));
    const dense = [1, 3].map((i) => ({ weight: layer(`head.${i}.weight`), bias: layer(`head.${i}.bias`) }));
    const predict = (input: Float32Array): [number, number, number] => {
      let x: Tensor = { data: input, channels: 3, size: metrics.stamp };
      x = relu(conv3(x, convs[0].weight.values, convs[0].bias.values));
      x = relu(conv3(x, convs[1].weight.values, convs[1].bias.values));
      x = maxPool2(x);
      x = relu(conv3(x, convs[2].weight.values, convs[2].bias.values));
      const hidden = linear(x.data, dense[0].weight.values, dense[0].bias.values).map((v) => Math.max(0, v));
      const out = linear(hidden, dense[1].weight.values, dense[1].bias.values);
      return [out[0], out[1], out[2]];
    };
    return { metrics, predict };
  })();
  return modelPromise;
}

function conv3(input: Tensor, weight: Float32Array, bias: Float32Array): Tensor {
  const outChannels = bias.length;
  const outSize = input.size - 2;
  const out = new Float32Array(outChannels * outSize * outSize);
  const { data, channels, size } = input;
  for (let o = 0; o < outChannels; o++) {
    for (let c = 0; c < channels; c++) {
      const w = (o * channels + c) * 9;
      for (let y = 0; y < outSize; y++) {
        for (let x = 0; x < outSize; x++) {
          const base = c * size * size + y * size + x;
          out[o * outSize * outSize + y * outSize + x] +=
            data[base] * weight[w] + data[base + 1] * weight[w + 1] + data[base + 2] * weight[w + 2] +
            data[base + size] * weight[w + 3] + data[base + size + 1] * weight[w + 4] + data[base + size + 2] * weight[w + 5] +
            data[base + 2 * size] * weight[w + 6] + data[base + 2 * size + 1] * weight[w + 7] + data[base + 2 * size + 2] * weight[w + 8];
        }
      }
    }
    const plane = o * outSize * outSize;
    for (let i = 0; i < outSize * outSize; i++) out[plane + i] += bias[o];
  }
  return { data: out, channels: outChannels, size: outSize };
}

function relu(tensor: Tensor): Tensor {
  for (let i = 0; i < tensor.data.length; i++) if (tensor.data[i] < 0) tensor.data[i] = 0;
  return tensor;
}

function maxPool2(input: Tensor): Tensor {
  const outSize = Math.floor(input.size / 2);
  const out = new Float32Array(input.channels * outSize * outSize);
  for (let c = 0; c < input.channels; c++) {
    for (let y = 0; y < outSize; y++) {
      for (let x = 0; x < outSize; x++) {
        const base = c * input.size * input.size + 2 * y * input.size + 2 * x;
        out[c * outSize * outSize + y * outSize + x] = Math.max(
          input.data[base], input.data[base + 1], input.data[base + input.size], input.data[base + input.size + 1],
        );
      }
    }
  }
  return { data: out, channels: input.channels, size: outSize };
}

function linear(input: Float32Array, weight: Float32Array, bias: Float32Array): Float32Array {
  const out = new Float32Array(bias.length);
  for (let o = 0; o < bias.length; o++) {
    let sum = bias[o];
    const row = o * input.length;
    for (let i = 0; i < input.length; i++) sum += input[i] * weight[row + i];
    out[o] = sum;
  }
  return out;
}
