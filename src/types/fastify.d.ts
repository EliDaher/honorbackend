import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string;
      username: string;
      role: 'admin' | 'worker' | 'employee' | 'user';
      contactId?: string;
    };
    user: {
      id: string;
      username: string;
      role: 'admin' | 'worker' | 'employee' | 'user';
      contactId?: string;
    };
  }
}
