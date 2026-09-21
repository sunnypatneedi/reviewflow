"""Optional official SDK compatibility check; never substitutes for LS UI testing."""
import importlib.util
import unittest

from trace2preference import core
from test_core import fixture


@unittest.skipUnless(importlib.util.find_spec("label_studio_sdk"), "official label-studio-sdk not installed")
class OfficialSDKCompatibility(unittest.TestCase):
    def test_official_parser_and_annotation_validation(self):
        from label_studio_sdk.label_interface import LabelInterface

        for condition in ("human_only", "model_assisted"):
            kit = core.labelstudio({"validation": core.validate(fixture()), "condition": condition})
            interface = LabelInterface(kit["config"])
            for choice in core.LS_CHOICES:
                result = [{"from_name": "preference", "to_name": "a", "type": "choices",
                           "value": {"choices": [choice]}}]
                if condition == "model_assisted":
                    result.append({"from_name": "assistance", "to_name": "a", "type": "choices",
                                   "value": {"choices": ["Reveal model proposal"]}})
                self.assertTrue(interface.validate_annotation({"result": result}),
                                f"{condition}: {choice}")


if __name__ == "__main__":
    unittest.main()