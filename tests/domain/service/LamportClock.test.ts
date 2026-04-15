import { beforeEach, describe, expect, it } from "vitest";
import { LamportClock } from "@/domain/service/LamportClock";

describe("LamportClock", () => {
	let clock: LamportClock;

	beforeEach(() => {
		clock = new LamportClock();
	});

	it("test_tick_InitialState_ReturnsOne", () => {
		expect(clock.tick()).toBe(1);
	});

	it("test_tick_MultipleCalls_Increments", () => {
		clock.tick();
		clock.tick();
		expect(clock.tick()).toBe(3);
	});

	it("test_current_BeforeTick_ReturnsZero", () => {
		expect(clock.current()).toBe(0);
	});

	it("test_current_AfterTick_ReflectsLatestValue", () => {
		clock.tick();
		clock.tick();
		expect(clock.current()).toBe(2);
	});

	it("test_merge_ReceivedHigher_UpdatesCounter", () => {
		clock.merge(10);
		expect(clock.current()).toBe(10);
	});

	it("test_merge_ReceivedLower_NoChange", () => {
		clock.tick(); // counter = 1
		clock.merge(0);
		expect(clock.current()).toBe(1);
	});

	it("test_tick_AfterMerge_ExceedsMergedValue", () => {
		clock.merge(5);
		expect(clock.tick()).toBe(6);
	});

	it("test_merge_SameValue_NoChange", () => {
		clock.tick(); // counter = 1
		clock.merge(1);
		expect(clock.current()).toBe(1);
	});
});
