export type ConnectionType = "need" | "offer" | "together";
export type ApiError = {
  error: { code: string; message: string; issues?: unknown[] };
};
export type ApiResponse<T> = { data: T; nextCursor?: string | null };
export type PublicProfile = {
  id: string;
  name: string;
  age: number;
  occupation?: string;
  bio: string;
  city: string;
  area?: string;
  interests: string[];
  photos: string[];
};
