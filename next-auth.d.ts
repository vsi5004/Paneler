// Module augmentation: extend Auth.js v5's Session.user with the `id` field
// our session callback in lib/auth.ts populates from token.sub.
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
