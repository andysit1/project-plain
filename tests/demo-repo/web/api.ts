// Typed API wrappers for the demo web app.
import { request } from "./client";

export interface User {
  id: string;
  name: string;
}

export interface Post {
  id: string;
  title: string;
}

export async function fetchUser(id: string): Promise<User> {
  return request(`/users/${id}`);
}

export async function fetchPosts(userId: string): Promise<Post[]> {
  return request(`/users/${userId}/posts`);
}
