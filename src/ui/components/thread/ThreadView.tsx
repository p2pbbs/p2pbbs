import type { DisplayPost } from "@/ui/hooks/usePostList";
import { PostItem } from "./PostItem";

type Props = {
	title: string;
	/** isUnread は省略可。未読マーカーを出さない呼び出し（テスト等）にも対応する。 */
	posts: ReadonlyArray<DisplayPost & { isUnread?: boolean }>;
};

export function ThreadView({ title, posts }: Props) {
	return (
		<main className="px-4 sm:px-6 lg:px-8 py-6 w-full max-w-3xl mx-auto">
			<h1 className="text-2xl font-medium mb-6">{title}</h1>
			<ol>
				{posts.map((post) => (
					<li key={post.id}>
						<PostItem post={post} isUnread={post.isUnread ?? false} />
					</li>
				))}
			</ol>
		</main>
	);
}
