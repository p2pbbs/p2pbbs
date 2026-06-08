import { Link } from "react-router-dom";

type Props = {
	message: string;
};

export function NotFound({ message }: Props) {
	return (
		<main className="flex flex-col items-center justify-center h-screen gap-3 text-sm text-gray-500 dark:text-gray-400">
			<p>{message}</p>
			<Link to="/" className="text-blue-600 dark:text-blue-400 hover:underline">
				板一覧へ戻る
			</Link>
		</main>
	);
}
