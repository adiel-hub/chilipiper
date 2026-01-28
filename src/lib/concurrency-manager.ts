/**
 * Concurrency Manager
 * Manages concurrent request execution with semaphore-based limiting and queuing
 */

interface QueuedRequest<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout?: NodeJS.Timeout;
}

export class ConcurrencyManager {
  private semaphore: number;
  private activeCount: number = 0;
  private queue: QueuedRequest<any>[] = [];
  private maxQueueSize: number;
  private defaultTimeout: number;
  private isProcessing: boolean = false; // Prevent concurrent queue processing

  constructor(
    maxConcurrent: number = 3,
    maxQueueSize: number = 50,
    defaultTimeout: number = 30000 // 30 seconds
  ) {
    this.semaphore = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Execute a function with concurrency limiting
   * Returns a promise that resolves when the function can execute
   */
  async execute<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const requestTimeout = timeout || this.defaultTimeout;

      // Check if queue is full
      if (this.queue.length >= this.maxQueueSize) {
        reject(new Error('Request queue is full. Please try again later.'));
        return;
      }

      const queuedRequest: QueuedRequest<T> = {
        id: requestId,
        execute: fn,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      // Set timeout for queued request
      queuedRequest.timeout = setTimeout(() => {
        const index = this.queue.findIndex(r => r.id === requestId);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error(`Request timeout after ${requestTimeout}ms in queue`));
        }
      }, requestTimeout);

      this.queue.push(queuedRequest);
      this.processQueue();
    });
  }

  /**
   * Process the queue, executing requests up to the concurrency limit
   * Made atomic to prevent race conditions
   */
  private async processQueue(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return;
    }

    // Don't process if we're at capacity or queue is empty
    if (this.activeCount >= this.semaphore || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      // Process as many requests as we can (up to semaphore limit)
      while (this.activeCount < this.semaphore && this.queue.length > 0) {
        // Get the next request from queue
        const request = this.queue.shift();
        if (!request) {
          break;
        }

        // Clear timeout since we're processing it
        if (request.timeout) {
          clearTimeout(request.timeout);
        }

        this.activeCount++;
        console.log(`🚦 Concurrency: ${this.activeCount}/${this.semaphore} active, ${this.queue.length} queued`);

        // Execute the request (don't await - let it run asynchronously)
        request
          .execute()
          .then(result => {
            this.activeCount--;
            request.resolve(result);
            // Process next item in queue
            this.processQueue();
          })
          .catch(error => {
            this.activeCount--;
            request.reject(error);
            // Process next item in queue
            this.processQueue();
          });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get current status
   */
  getStatus(): {
    active: number;
    queued: number;
    capacity: number;
    queueSize: number;
  } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      capacity: this.semaphore,
      queueSize: this.maxQueueSize,
    };
  }

  /**
   * Clear the queue (for shutdown/cleanup)
   */
  clearQueue(): void {
    this.queue.forEach(request => {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      request.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }
}

// Singleton instance with configurable limits
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '10', 10);
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '100', 10);
const QUEUE_TIMEOUT = parseInt(process.env.QUEUE_TIMEOUT_MS || '90000', 10);

export const concurrencyManager = new ConcurrencyManager(
  MAX_CONCURRENT,
  MAX_QUEUE_SIZE,
  QUEUE_TIMEOUT
);

