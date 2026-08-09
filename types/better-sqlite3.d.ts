declare module "better-sqlite3" {
  type DatabaseOptions = {
    readonly?: boolean;
    fileMustExist?: boolean;
  };

  class Statement {
    pluck(): Statement;
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown[];
  }

  export default class Database {
    constructor(filename: string, options?: DatabaseOptions);
    prepare(source: string): Statement;
    close(): void;
  }
}
