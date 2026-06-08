import { Link } from "react-router-dom";
import { BOARDS } from "@/core/config/constants";

export function BoardListView() {
	return (
		<main className="px-4 sm:px-6 lg:px-8 py-6 w-full max-w-3xl mx-auto">
			<h1 className="text-2xl font-medium mb-6">nch 板一覧</h1>
			<ul className="flex flex-col gap-2">
				{BOARDS.map((board) => (
					<li key={board.boardId}>
						<Link
							to={`/board/${board.boardId}`}
							className="block rounded border border-gray-200 dark:border-gray-700 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
						>
							<span className="font-medium">{board.name}</span>
							<span className="ml-2 text-sm text-gray-400 dark:text-gray-500">
								/{board.boardId}/
							</span>
						</Link>
					</li>
				))}
			</ul>
		</main>
	);
}
