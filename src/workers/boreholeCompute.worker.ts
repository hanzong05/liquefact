import type {DatasetBorehole} from "../utils/constants/datasetBoreholes.type";
import {
  computeGeotechnicalForDatasetBorehole,
  type BoreholeMapResult,
} from "../computation/liquefactionComputations";

type WorkerRequest = {
  requestId: string;
  boreholes: DatasetBorehole[];
  earthquakeMagnitude: number;
};

type WorkerProgressResponse = {
  type: "progress";
  requestId: string;
  processed: number;
  total: number;
};

type WorkerResultResponse = {
  type: "result";
  requestId: string;
  results: BoreholeMapResult[];
};

type WorkerErrorResponse = {
  type: "error";
  requestId: string;
  message: string;
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const {requestId, boreholes, earthquakeMagnitude} = event.data;
  const results: BoreholeMapResult[] = [];
  let processed = 0;

  try {
    for (const borehole of boreholes) {
      const result = await computeGeotechnicalForDatasetBorehole(
        borehole,
        earthquakeMagnitude,
      );
      if (result) {
        results.push(result);
      }
      processed += 1;
      if (processed % 4 === 0 || processed === boreholes.length) {
        const progressMessage: WorkerProgressResponse = {
          type: "progress",
          requestId,
          processed,
          total: boreholes.length,
        };
        self.postMessage(progressMessage);
      }
    }

    const resultMessage: WorkerResultResponse = {
      type: "result",
      requestId,
      results,
    };
    self.postMessage(resultMessage);
  } catch (error) {
    const errorMessage: WorkerErrorResponse = {
      type: "error",
      requestId,
      message:
        error instanceof Error
          ? error.message
          : "Unknown worker computation error.",
    };
    self.postMessage(errorMessage);
  }
};
