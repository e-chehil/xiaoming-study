"""Tests for dependencies, exact local optimization and deterministic ranking."""
import itertools
import math
import unittest
from build_learning_order import Corpus, greedy_order, refine, solve_block, unique_han


class OrderTests(unittest.TestCase):
    def corpus(self):
        return Corpus([{"rank": i, "word": w, "pinyin": "test"} for i, w in enumerate(
            ["我们", "我", "人", "他们", "好人", "好好", "你好", "你们", "我"], 1)])

    def test_han_prerequisites(self):
        self.assertEqual(unique_han("鹬蚌相争,渔翁得利"), tuple("鹬蚌相争渔翁得利"))
        self.assertEqual(unique_han("人人"), ("人",))
        self.assertEqual(unique_han("卡拉OK"), ("卡", "拉"))
        self.assertEqual(unique_han("〇𠀀"), ("〇", "𠀀"))

    def test_exact_block_against_exhaustive_search(self):
        corpus = self.corpus()
        order = list(range(len(corpus.chars)))
        masks = {}
        for weight, deps in zip(corpus.weights, corpus.deps):
            mask = sum(1 << c for c in deps)
            masks[mask] = masks.get(mask, 0) + weight
        result = solve_block(order, masks)
        brute = min(corpus.objective(o) for o in itertools.permutations(order))
        self.assertAlmostEqual(corpus.objective(result), brute, places=11)

    def test_greedy_complete_deterministic_and_refinement(self):
        corpus = self.corpus()
        for p in [0, 1, 2, math.inf]:
            order = greedy_order(corpus, p)
            self.assertEqual(order, greedy_order(corpus, p))
            self.assertEqual(set(order), set(range(len(corpus.chars))))
            improved = refine(corpus, order, width=4, passes=2)
            self.assertLessEqual(corpus.objective(improved), corpus.objective(order) + 1e-10)


if __name__ == "__main__":
    unittest.main()
