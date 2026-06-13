import { describe, expect, it } from "vitest";
import { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import { TEST_THREAD_ID } from "../../helpers/constants";

describe("LamportClockMap", () => {
	it("test_get_UnknownThreadId_ReturnsFreshClock", () => {
		const map = new LamportClockMap();
		const clock = map.get(TEST_THREAD_ID);
		expect(clock.current()).toBe(0);
	});

	it("test_get_SameThreadId_ReturnsSameInstance", () => {
		const map = new LamportClockMap();
		const clock1 = map.get(TEST_THREAD_ID);
		const clock2 = map.get(TEST_THREAD_ID);
		expect(clock1).toBe(clock2);
	});

	it("test_get_DifferentThreadIds_ReturnDifferentInstances", () => {
		const map = new LamportClockMap();
		const clock1 = map.get(TEST_THREAD_ID);
		const clock2 = map.get("thread-2");
		expect(clock1).not.toBe(clock2);
	});

	it("test_get_ThreadTicksDoNotAffectOtherThread", () => {
		const map = new LamportClockMap();
		const clock1 = map.get(TEST_THREAD_ID);
		clock1.tick();
		clock1.tick();
		clock1.tick();

		const clock2 = map.get("thread-2");
		expect(clock2.current()).toBe(0);
	});

	it("test_get_AutoCreatedClockStartsAtZero", () => {
		const map = new LamportClockMap();
		const clock = map.get("new-thread");
		expect(clock.current()).toBe(0);
	});

	it("test_get_TickAndMerge_WorksPerThread", () => {
		const map = new LamportClockMap();
		const clockA = map.get("thread-a");
		const clockB = map.get("thread-b");

		clockA.tick(); // 1
		clockA.merge(5); // 5

		expect(clockA.current()).toBe(5);
		expect(clockB.current()).toBe(0);
	});

	it("test_get_MultipleNewThreads_EachStartsAtZero", () => {
		const map = new LamportClockMap();
		for (let i = 0; i < 10; i++) {
			const clock = map.get(`thread-${i}`);
			expect(clock.current()).toBe(0);
		}
	});
});
