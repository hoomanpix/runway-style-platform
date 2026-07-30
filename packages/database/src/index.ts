export interface DatabaseClient {
  connect(): Promise<void>;
}
