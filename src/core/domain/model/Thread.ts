import type { Post } from "./Post";

/** スレ: レスの集合。 */
export type Thread = {
	readonly id: string;
	readonly title: string;
	readonly boardId: string;
	readonly posts: Post[];
	readonly createdAt: number;
};
