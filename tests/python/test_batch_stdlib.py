"""Standard-library-only tests for the batch command's safe preflight paths."""
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipelines.scene_reconstruction import batch


class ParseArgsTests(unittest.TestCase):
    def test_defaults_and_required_input_output(self):
        args = batch.parse_args(["--input", "photo.jpg", "--output", "run"])
        self.assertEqual(args.input, Path("photo.jpg"))
        self.assertEqual(args.output, Path("run"))
        self.assertEqual(args.max_objects, 4)
        self.assertEqual(args.candidates, 2)
        self.assertEqual(args.seed, 42)
        self.assertEqual(args.sampling_seed, 42)
        independent = batch.parse_args(['--input','photo.jpg','--output','run','--seed','7','--sampling-seed','19'])
        self.assertEqual((independent.seed, independent.sampling_seed), (7,19))
        self.assertEqual(args.point_budget, 8000)
        self.assertEqual(args.max_side, 1024)

    def test_check_environment_allows_missing_paths(self):
        args = batch.parse_args(["--check-environment"])
        self.assertIsNone(args.input)
        self.assertIsNone(args.output)

    def test_input_and_output_required_without_check_environment(self):
        for argv in ([], ["--input", "photo.jpg"], ["--output", "run"]):
            with self.subTest(argv=argv), self.assertRaises(SystemExit) as raised:
                batch.parse_args(argv)
            self.assertEqual(raised.exception.code, 2)

    def test_numeric_bounds_reject_values_outside_range(self):
        base = ["--input", "photo.jpg", "--output", "run"]
        cases = (("--max-objects", "0"), ("--max-objects", "9"),
                 ("--candidates", "0"), ("--candidates", "4"),
                 ("--seed", "-1"), ("--seed", "2147483648"),
                 ("--sampling-seed", "-1"), ("--sampling-seed", "2147483648"),
                 ("--point-budget", "999"), ("--point-budget", "150001"),
                 ("--max-side", "255"), ("--max-side", "1025"))
        for flag, value in cases:
            with self.subTest(flag=flag, value=value), self.assertRaises(SystemExit) as raised:
                batch.parse_args(base + [flag, value])
            self.assertEqual(raised.exception.code, 2)

    def test_numeric_bounds_include_endpoints(self):
        args = batch.parse_args(["--input", "x", "--output", "y", "--max-objects", "1",
                                 "--candidates", "3", "--seed", "0", "--point-budget", "150000",
                                 "--max-side", "256"])
        self.assertEqual((args.max_objects, args.candidates, args.seed, args.point_budget, args.max_side),
                         (1, 3, 0, 150000, 256))


class FilesAndValidationTests(unittest.TestCase):
    def test_model_file_status_checks_directories_files_and_sha256_hex(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo = root / "repo"
            repo.mkdir()
            config = root / "config.yaml"
            sam2 = root / "sam2.ckpt"
            lama = root / "lama.ckpt"
            for path in (config, sam2, lama):
                path.write_bytes(b"weights or config")
            env = {"SAM3D_REPO": str(repo), "SAM3D_CONFIG": str(config),
                   "SAM2_CHECKPOINT": str(sam2), "LAMA_CHECKPOINT": str(lama),
                   "LAMA_SHA256": "aB" * 32}
            self.assertEqual(batch.model_file_status(env), {key: True for key in batch.MODEL_FIELDS})
            env["SAM3D_REPO"] = str(config)
            env["SAM3D_CONFIG"] = str(root / "missing")
            env["LAMA_SHA256"] = "g" * 64
            status = batch.model_file_status(env)
            self.assertFalse(status["SAM3D_REPO"])
            self.assertFalse(status["SAM3D_CONFIG"])
            self.assertFalse(status["LAMA_SHA256"])

    def test_input_digest_matches_sha256(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "input.bin"
            data = b"a small saved photo fixture\x00\xff"
            path.write_bytes(data)
            self.assertEqual(batch.input_digest(path), hashlib.sha256(data).hexdigest())
            self.assertEqual(len(batch.input_digest(path)), 64)

    def test_validation_plan_distinguishes_unobservable_hidden_truth(self):
        plan = batch.validation_plan()
        self.assertEqual(plan["status"], "not_evaluated")
        self.assertEqual(batch.validation_plan(19)['sampling_seed'],19)
        self.assertIn("true hidden backside geometry", plan["not_observable_from_one_photo"])
        self.assertIn("true occluded background appearance", plan["not_observable_from_one_photo"])
        self.assertIn("ground-truth hidden-surface accuracy", plan["warning"])


class RunPreflightTests(unittest.TestCase):
    def test_nonempty_output_is_refused_before_environment_preflight(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "photo.jpg"
            source.write_bytes(b"not decoded; preflight must not be reached")
            output = root / "existing"
            output.mkdir()
            (output / "keep.txt").write_text("preserve")
            args = batch.parse_args(["--input", str(source), "--output", str(output)])
            with patch.object(batch, "environment_report") as report:
                with self.assertRaisesRegex(ValueError, "new or empty directory"):
                    batch.run(args)
                report.assert_not_called()
            self.assertEqual((output / "keep.txt").read_text(), "preserve")

    def test_unavailable_preflight_does_not_create_output_or_claim_conversion(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "photo.jpg"
            source.write_bytes(b"saved input placeholder")
            output = root / "new-run"
            args = batch.parse_args(["--input", str(source), "--output", str(output)])
            unavailable = {"preflight_ready": False, "cuda_available": False,
                           "gpu_inference_run": False}
            with patch.object(batch, "environment_report", return_value=unavailable) as report:
                with self.assertRaisesRegex(RuntimeError, "no conversion was performed"):
                    batch.run(args)
                report.assert_called_once_with()
            self.assertFalse(output.exists())
            self.assertFalse((output / "manifest.json").exists())
            self.assertFalse((output / "conversion-record.json").exists())
            self.assertFalse(unavailable["gpu_inference_run"])


if __name__ == "__main__":
    unittest.main()
