// cookie@0.7.2 (dependency chuyển tiếp của express@5.2.1, xác nhận qua `npm ls cookie`) không kèm
// file khai báo kiểu (không có "types" trong package.json, không có .d.ts) — khai tối thiểu đúng 2
// hàm đang dùng thật (server/lib/auth-middleware.ts, server/routes/auth.ts).
declare module 'cookie' {
  export interface CookieSerializeOptions {
    domain?: string;
    encode?: (value: string) => string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    priority?: 'low' | 'medium' | 'high';
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    secure?: boolean;
  }

  export interface CookieParseOptions {
    decode?: (value: string) => string;
  }

  export function parse(input: string, options?: CookieParseOptions): Record<string, string>;
  export function serialize(name: string, value: string, options?: CookieSerializeOptions): string;
}
