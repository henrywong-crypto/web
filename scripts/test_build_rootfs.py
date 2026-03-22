"""Tests for pure functions in build_rootfs.py.

These tests cover functions that can be verified without mocking subprocess
calls or network requests: is_versioned_kernel() and kernel_version_tuple().
"""

import importlib.util
import pathlib
import sys
import unittest


# ── Load build_rootfs module without executing main() ─────────────────────


def _load_build_rootfs():
    """Import build_rootfs.py as a module without side effects."""
    spec = importlib.util.spec_from_file_location(
        "build_rootfs",
        pathlib.Path(__file__).parent / "build_rootfs.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


build_rootfs = _load_build_rootfs()


# ── is_versioned_kernel tests ─────────────────────────────────────────────


class TestIsVersionedKernel(unittest.TestCase):
    """is_versioned_kernel returns True only for plain version kernels like vmlinux-6.1.155."""

    def test_simple_versioned_kernel(self):
        self.assertTrue(
            build_rootfs.is_versioned_kernel("firecracker-ci/v1.14/x86_64/vmlinux-6.1.155")
        )

    def test_two_part_version(self):
        self.assertTrue(
            build_rootfs.is_versioned_kernel("firecracker-ci/v1.14/x86_64/vmlinux-5.10")
        )

    def test_four_part_version(self):
        self.assertTrue(
            build_rootfs.is_versioned_kernel("path/to/vmlinux-6.1.155.1")
        )

    def test_plain_filename_versioned(self):
        self.assertTrue(build_rootfs.is_versioned_kernel("vmlinux-6.1.155"))

    def test_rejects_acpi_kernel(self):
        """vmlinux-acpi-* names should be rejected (contain extra hyphens)."""
        self.assertFalse(
            build_rootfs.is_versioned_kernel("firecracker-ci/v1.14/x86_64/vmlinux-acpi-6.1.155")
        )

    def test_rejects_name_with_extra_hyphen(self):
        self.assertFalse(
            build_rootfs.is_versioned_kernel("path/vmlinux-foo-6.1.155")
        )

    def test_rejects_non_numeric_version(self):
        """Version parts must all be digits."""
        self.assertFalse(
            build_rootfs.is_versioned_kernel("vmlinux-6.1.beta")
        )

    def test_rejects_version_with_alpha_suffix(self):
        self.assertFalse(
            build_rootfs.is_versioned_kernel("vmlinux-6.1.155rc1")
        )

    def test_single_number_version(self):
        self.assertTrue(build_rootfs.is_versioned_kernel("vmlinux-6"))


# ── kernel_version_tuple tests ────────────────────────────────────────────


class TestKernelVersionTuple(unittest.TestCase):
    """kernel_version_tuple extracts a comparable tuple of ints from an S3 key."""

    def test_three_part_version(self):
        result = build_rootfs.kernel_version_tuple(
            "firecracker-ci/v1.14/x86_64/vmlinux-6.1.155"
        )
        self.assertEqual(result, (6, 1, 155))

    def test_two_part_version(self):
        result = build_rootfs.kernel_version_tuple("path/vmlinux-5.10")
        self.assertEqual(result, (5, 10))

    def test_four_part_version(self):
        result = build_rootfs.kernel_version_tuple("vmlinux-6.1.155.1")
        self.assertEqual(result, (6, 1, 155, 1))

    def test_single_number_version(self):
        result = build_rootfs.kernel_version_tuple("vmlinux-6")
        self.assertEqual(result, (6,))

    def test_ordering_works_for_max(self):
        """Tuples should compare correctly so max() picks the latest kernel."""
        keys = [
            "path/vmlinux-5.10.100",
            "path/vmlinux-6.1.155",
            "path/vmlinux-6.1.10",
            "path/vmlinux-5.15.200",
        ]
        best = max(keys, key=build_rootfs.kernel_version_tuple)
        self.assertEqual(best, "path/vmlinux-6.1.155")

    def test_plain_filename(self):
        result = build_rootfs.kernel_version_tuple("vmlinux-4.14.336")
        self.assertEqual(result, (4, 14, 336))


if __name__ == "__main__":
    unittest.main()
