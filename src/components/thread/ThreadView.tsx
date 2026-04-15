import type { Post } from "@/domain/model/Post";
import { PostItem } from "./PostItem";

type Props = {
	title: string;
	posts: Post[];
};

export function ThreadView({ title, posts }: Props) {
	return (
		<main className="px-4 sm:px-6 lg:px-8 py-6 w-full max-w-3xl mx-auto">
			<h1 className="text-2xl font-medium mb-6">{title}</h1>
			<ol>
				{posts.map((post) => (
					<li key={post.id}>
						<PostItem post={post} />
					</li>
				))}
			</ol>
		</main>
	);
}
