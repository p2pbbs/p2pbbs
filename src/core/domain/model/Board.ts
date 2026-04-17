import type { Thread } from "./Thread";

/** 板: スレッドの集合。MVP では1つ固定。 */
export type Board = {
	readonly id: string;
	readonly name: string;
	readonly threads: Thread[];
};
