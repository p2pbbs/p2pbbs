import { useState } from "react";
import { DEFAULT_NAME, MAX_POST_BYTES } from "@/config/constants";

type Props = {
	onSubmit: (name: string, body: string) => void;
};

export function PostForm({ onSubmit }: Props) {
	const [name, setName] = useState("");
	const [body, setBody] = useState("");

	const bodyBytes = new TextEncoder().encode(body).length;
	const isOverLimit = bodyBytes > MAX_POST_BYTES;
	const isSubmitDisabled = body.trim() === "" || isOverLimit;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (isSubmitDisabled) return;
		onSubmit(name, body);
		setBody("");
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="px-4 sm:px-6 lg:px-8 py-4 w-full max-w-3xl mx-auto border-t border-gray-200 dark:border-gray-700"
		>
			<div className="flex flex-col gap-2">
				<input
					type="text"
					placeholder={DEFAULT_NAME}
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="w-full sm:w-48 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-500"
				/>
				<textarea
					placeholder="本文を入力..."
					value={body}
					onChange={(e) => setBody(e.target.value)}
					rows={4}
					className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-500 resize-none"
				/>
				<div className="flex items-center justify-between">
					<span
						className={`text-xs ${isOverLimit ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-gray-500"}`}
					>
						{bodyBytes} / {MAX_POST_BYTES} bytes
					</span>
					<button
						type="submit"
						disabled={isSubmitDisabled}
						className="px-4 py-1.5 text-sm rounded bg-gray-700 dark:bg-gray-600 text-white disabled:opacity-40 hover:bg-gray-600 dark:hover:bg-gray-500 transition-colors"
					>
						書き込む
					</button>
				</div>
			</div>
		</form>
	);
}
