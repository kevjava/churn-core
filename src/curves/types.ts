export interface CurveMetadata {
  type: string;
  parameters: Record<string, unknown>;
  description: string;
}

export interface PriorityCurve {
  calculate(datetime: Date): number;
  metadata(): CurveMetadata;
}

export interface AsyncPriorityCurve {
  calculate(datetime: Date): Promise<number>;
  metadata(): CurveMetadata;
}
