/**
 * Unit tests for collectAddedRoots() and debounce() from content.observer.js
 * (issue #18).
 *
 * content.observer.js does not exist yet; the import below is intentionally
 * unresolvable so every test in this file starts red.
 *
 * collectAddedRoots(records) — accepts an array of MutationRecord-shaped
 * objects and returns a Set of Element nodes that should be re-segmented.
 * In production these are real MutationRecords; in tests, plain objects whose
 * addedNodes array contains real JSDOM nodes are used.
 *
 * debounce(fn, delay) — returns a trailing-edge debounced wrapper: N calls
 * within `delay` ms result in fn being invoked exactly once after `delay`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectAddedRoots, debounce } from './content.observer.js';

// ---------------------------------------------------------------------------
// collectAddedRoots — positive cases (element nodes are included)
// ---------------------------------------------------------------------------

describe('collectAddedRoots — qualifying element nodes are returned', () => {
  it('T-18-001 test_div_element_in_added_nodes_is_included_in_result_set', () => {
    // A plain <div> is the prototypical container for dynamically injected
    // content; it must be returned so segmentAndWrap can be applied to it.
    const div = document.createElement('div');
    div.textContent = '日本語';
    const records = [{ addedNodes: [div] }];

    const result = collectAddedRoots(records);

    expect(result).toBeInstanceOf(Set);
    expect(result.has(div)).toBe(true);
  });

  it('T-18-002 test_multiple_records_with_qualifying_elements_are_all_aggregated', () => {
    // A MutationObserver fires one record per mutation; multiple mutations in
    // a single callback must each contribute their elements to one unified Set.
    const div1 = document.createElement('div');
    const div2 = document.createElement('article');
    const records = [
      { addedNodes: [div1] },
      { addedNodes: [div2] },
    ];

    const result = collectAddedRoots(records);

    expect(result.has(div1)).toBe(true);
    expect(result.has(div2)).toBe(true);
    expect(result.size).toBe(2);
  });

  it('T-18-003 test_mixed_nodes_in_one_record_include_only_qualifying_element', () => {
    // A single MutationRecord can carry a mix of element, text, and span nodes;
    // only the element that is not a SPAN should make it into the result set.
    const div = document.createElement('div');
    const span = document.createElement('span');
    const text = document.createTextNode('テキスト');
    const records = [{ addedNodes: [div, span, text] }];

    const result = collectAddedRoots(records);

    expect(result.has(div)).toBe(true);
    expect(result.has(span)).toBe(false);
    expect(result.size).toBe(1);
  });

  it('T-18-004 test_empty_records_array_returns_empty_set', () => {
    // When no mutations have occurred (empty records array) the function must
    // return an empty Set rather than throw or return undefined.
    const result = collectAddedRoots([]);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-4: non-element nodes are excluded
// ---------------------------------------------------------------------------

describe('collectAddedRoots — AC-4: non-element nodes are excluded', () => {
  it('T-18-005 test_text_node_only_record_returns_empty_set', () => {
    // Text nodes (nodeType 3) are never re-segmented directly; only their
    // Element parent is enqueued so segmentAndWrap can walk the full subtree.
    const text = document.createTextNode('新しいコンテンツ');
    const records = [{ addedNodes: [text] }];

    const result = collectAddedRoots(records);

    expect(result.size).toBe(0);
  });

  it('T-18-006 test_comment_node_only_record_returns_empty_set', () => {
    // Comment nodes (nodeType 8) are invisible markup; including them would
    // cause segmentAndWrap to attempt to walk a non-element node.
    const comment = document.createComment('動的コンテンツ');
    const records = [{ addedNodes: [comment] }];

    const result = collectAddedRoots(records);

    expect(result.size).toBe(0);
  });

  it('T-18-007 test_record_with_text_and_comment_nodes_only_returns_empty_set', () => {
    // A record with multiple non-element nodes must still produce an empty Set;
    // the filter must apply per-node and not relax when there are many nodes.
    const text = document.createTextNode('追加されたテキスト');
    const comment = document.createComment('コメント');
    const records = [{ addedNodes: [text, comment] }];

    const result = collectAddedRoots(records);

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-5: self-inserted SPAN elements are excluded
// ---------------------------------------------------------------------------

describe('collectAddedRoots — AC-5: SPAN elements are excluded', () => {
  it('T-18-008 test_span_only_added_node_returns_empty_set', () => {
    // The observer fires when segmentAndWrap inserts its own <span> elements;
    // including those spans would create an infinite re-segmentation loop.
    const span = document.createElement('span');
    span.textContent = '走る';
    const records = [{ addedNodes: [span] }];

    const result = collectAddedRoots(records);

    expect(result.size).toBe(0);
  });

  it('T-18-009 test_multiple_spans_in_added_nodes_are_all_excluded', () => {
    // Multiple self-inserted spans from one segmentAndWrap pass must all be
    // ignored so the debounced callback does not re-trigger segmentation.
    const span1 = document.createElement('span');
    const span2 = document.createElement('span');
    const records = [{ addedNodes: [span1, span2] }];

    const result = collectAddedRoots(records);

    expect(result.size).toBe(0);
  });

  it('T-18-010 test_span_with_class_is_excluded_regardless_of_class', () => {
    // Even a span carrying anki-* classes is a SPAN; the check is on nodeName,
    // not class, so every span regardless of attributes must be filtered out.
    const span = document.createElement('span');
    span.className = 'anki-unlearned';
    const records = [{ addedNodes: [span] }];

    const result = collectAddedRoots(records);

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-6: debounce — fn called once after delay despite multiple rapid calls
// ---------------------------------------------------------------------------

describe('debounce — AC-6: rapid calls within delay result in one invocation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T-18-011 test_fn_is_not_called_before_delay_elapses', () => {
    // The whole point of debouncing is to suppress calls while events are
    // still arriving; fn must be silent until the trailing edge fires.
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    // No time has passed — fn must not have been called yet.
    expect(fn).not.toHaveBeenCalled();
  });

  it('T-18-012 test_fn_called_exactly_once_after_delay_following_rapid_burst', () => {
    // N rapid invocations within the delay window must collapse to exactly one
    // call; calling fn multiple times would re-segment the same nodes N times.
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced();
    debounced();
    debounced();
    debounced();
    debounced();

    vi.advanceTimersByTime(200);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('T-18-013 test_single_call_fires_fn_after_delay', () => {
    // A single call with no subsequent calls within the window must still fire
    // fn — debounce must not suppress isolated calls permanently.
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 150);

    debounced();
    vi.advanceTimersByTime(150);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('T-18-014 test_second_burst_after_first_fires_fn_a_second_time', () => {
    // The debounced wrapper must be reusable: after the first burst settles and
    // fires fn, a fresh burst after the delay must also eventually fire fn once.
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    // First burst.
    debounced();
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    // Second burst, well after the first delay window.
    debounced();
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('T-18-015 test_most_recent_call_arguments_are_passed_to_fn', () => {
    // The observer callback receives the mutations array as its argument;
    // debounce must forward the last call's arguments, not the first call's.
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    debounced('second');
    debounced('third');

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('third');
  });

  it('T-18-016 test_fn_not_called_if_delay_has_not_fully_elapsed', () => {
    // Advancing time to just before the delay must not trigger fn; the
    // trailing edge fires only when the full delay has elapsed.
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced();
    vi.advanceTimersByTime(299);

    expect(fn).not.toHaveBeenCalled();
  });
});
