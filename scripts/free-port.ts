import { type AddressInfo, createServer } from 'node:net';

/** A port nothing listens on right now, so servers a script starts never collide with another run's. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
