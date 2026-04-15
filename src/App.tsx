import { InMemoryPostStore } from "@/adapter/storage/InMemoryPostStore";
import { DEFAULT_THREAD_ID } from "@/config/constants";
import type { Post } from "@/domain/model/Post";
import { BoardPage } from "./components/pages/BoardPage";

const GENESIS_POST: Post = {
	id: "genesis",
	number: 1,
	name: "名無しさん",
	body: "このスレを立てました。",
	odId: "00000000",
	timestamp: 0,
	signature: "",
	publicKey: "",
};

const store = new InMemoryPostStore(
	new Map([[DEFAULT_THREAD_ID, [GENESIS_POST]]]),
);

function App() {
	return <BoardPage store={store} />;
}

export default App;
