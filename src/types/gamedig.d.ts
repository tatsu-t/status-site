declare module 'gamedig' {
  export interface QueryOptions {
    type: string;
    host: string;
    port?: number;
    maxRetries?: number;
    socketTimeout?: number;
    attemptTimeout?: number;
    givenPortOnly?: boolean;
  }

  export interface Player {
    name?: string;
    raw?: Record<string, unknown>;
  }

  export interface QueryResult {
    name: string;
    map: string;
    password: boolean;
    maxplayers: number;
    players: Player[];
    bots: Player[];
    connect: string;
    ping: number;
  }

  export class GameDig {
    static query(options: QueryOptions): Promise<QueryResult>;
  }
}
