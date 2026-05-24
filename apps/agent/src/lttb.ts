export type Point = [ts: number, value: number];

export function lttb(data: Point[], threshold: number): Point[] {
  if (threshold >= data.length || threshold < 3) return data;

  const sampled: Point[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  let a = 0;
  sampled.push(data[a]!);

  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

    let avgX = 0;
    let avgY = 0;
    const avgRangeLength = rangeEnd - rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += data[j]![0];
      avgY += data[j]![1];
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const pointAStart = Math.floor(i * bucketSize) + 1;
    const pointABucketEnd = Math.floor((i + 1) * bucketSize) + 1;
    const pointAX = data[a]![0];
    const pointAY = data[a]![1];

    let maxArea = -1;
    let maxAreaIdx = pointAStart;
    for (let j = pointAStart; j < pointABucketEnd; j++) {
      const area = Math.abs(
        (pointAX - avgX) * (data[j]![1] - pointAY) -
          (pointAX - data[j]![0]) * (avgY - pointAY),
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = j;
      }
    }
    sampled.push(data[maxAreaIdx]!);
    a = maxAreaIdx;
  }

  sampled.push(data[data.length - 1]!);
  return sampled;
}
