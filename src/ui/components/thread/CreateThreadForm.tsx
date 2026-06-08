import { useState } from "react";
import {
	DEFAULT_NAME,
	MAX_POST_BYTES,
	MAX_THREAD_TITLE_BYTES,
} from "@/core/config/constants";

type Props = {
	onSubmit: (title: string, name: string, body: string) => void;
	/** ピアとの digest 同期が未完了（投稿可能になる前）。 */
	disabled?: boolean;
	/** スレ作成不可の理由（板のスレ上限到達など）。設定時はフォームを無効化して表示する。 */
	notice?: string;
};

export function CreateThreadForm({
	onSubmit,
	disabled = false,
	notice,
}: Props) {
	const [title, setTitle] = useState("");
	const [name, setName] = useState("");
	const [body, setBody] = useState("");

	const titleBytes = new TextEncoder().encode(title).length;
	const bodyBytes = new TextEncoder().encode(body).length;
	const isTitleOver = titleBytes > MAX_THREAD_TITLE_BYTES;
	const isBodyOver = bodyBytes > MAX_POST_BYTES;
	const isSubmitDisabled =
		disabled ||
		notice != null ||
		title.trim() === "" ||
		body.trim() === "" ||
		isTitleOver ||
		isBodyOver;

	const buttonLabel =
		notice != null ? "作成できません" : disabled ? "同期中..." : "スレを立てる";

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (isSubmitDisabled) return;
		onSubmit(title, name, body);
		setTitle("");
		setBody("");
	};

	return (
		<form onSubmit={handleSubmit} className="p-4">
			<h2 className="text-sm font-bold mb-3 text-gray-700 dark:text-gray-300">
				新しいスレを立てる
			</h2>
			{notice != null && (
				<p className="mb-2 text-sm text-amber-600 dark:text-amber-400">
					{notice}
				</p>
			)}
			<div className="flex flex-col gap-2">
				<input
					type="text"
					placeholder="スレタイトル"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-500"
				/>
				<input
					type="text"
					placeholder={DEFAULT_NAME}
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="w-full sm:w-48 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-500"
				/>
				<textarea
					placeholder="本文（>>1 になります）"
					value={body}
					onChange={(e) => setBody(e.target.value)}
					rows={3}
					className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-500 resize-none"
				/>
				<div className="flex items-center justify-between">
					<span
						className={`text-xs ${isTitleOver ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-gray-500"}`}
					>
						タイトル {titleBytes} / {MAX_THREAD_TITLE_BYTES} bytes
					</span>
					<button
						type="submit"
						disabled={isSubmitDisabled}
						className="px-4 py-1.5 text-sm rounded bg-gray-700 dark:bg-gray-600 text-white disabled:opacity-40 hover:bg-gray-600 dark:hover:bg-gray-500 transition-colors"
					>
						{buttonLabel}
					</button>
				</div>
			</div>
		</form>
	);
}
