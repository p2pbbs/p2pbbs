import { DEFAULT_NAME } from "@/config/constants";
import type { DisplayPost } from "@/hooks/usePosts";

type Props = {
	post: DisplayPost;
};

export function PostItem({ post }: Props) {
	const name = post.name !== "" ? post.name : DEFAULT_NAME;
	const dateStr = new Date(post.timestamp).toLocaleString("ja-JP");

	return (
		<article className="border-b border-gray-200 dark:border-gray-700 py-3 sm:py-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400 mb-1">
				<span className="font-mono font-bold text-gray-700 dark:text-gray-300">
					{post.displayNumber}
				</span>
				<span>{name}</span>
				<time dateTime={new Date(post.timestamp).toISOString()}>{dateStr}</time>
				<span className="font-mono text-xs">ID:{post.odId}</span>
			</div>
			<p className="text-base whitespace-pre-wrap break-words">{post.body}</p>
		</article>
	);
}
