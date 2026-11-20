import itertools
import unittest
from build_learning_order import Corpus
from build_step_order import audit, baseline, density_order, exact_job_block, objective, refine_jobs

class StepTests(unittest.TestCase):
    def corpus(self):
        return Corpus([{'rank':i,'word':w,'pinyin':'test'} for i,w in enumerate(['我','我们','人人','们','人'],1)])

    def test_density_is_valid_and_deterministic(self):
        c=self.corpus()
        for penalty in [0.5,1,2]:
            a=density_order(c,penalty)
            audit(c,a)
            self.assertEqual(a,density_order(c,penalty))

    def test_exact_mixed_block_matches_all_valid_permutations(self):
        c=self.corpus()
        jobs=baseline(c)
        result=exact_job_block(c,jobs)
        audit(c,result)
        best=float('inf')
        for seq in itertools.permutations(jobs):
            seen=set()
            valid=True
            for kind,i in seq:
                if not kind: seen.add(i)
                elif not set(c.deps[i])<=seen:
                    valid=False
                    break
            if valid: best=min(best,objective(c,seq))
        self.assertAlmostEqual(objective(c,result),best,places=10)

    def test_rare_ready_word_can_be_deferred(self):
        c=Corpus([{'rank':r,'word':w,'pinyin':'test'} for r,w in [(1,'人'),(2,'我'),(50000,'人人')]])
        jobs=density_order(c)
        audit(c,jobs)
        words=[c.entries[i]['word'] for kind,i in jobs if kind]
        self.assertEqual(words,['人','我','人人'])
        improved=refine_jobs(c,jobs,width=4,passes=2)
        audit(c,improved)
        self.assertLessEqual(objective(c,improved),objective(c,jobs)+1e-10)

if __name__=='__main__':
    unittest.main()
