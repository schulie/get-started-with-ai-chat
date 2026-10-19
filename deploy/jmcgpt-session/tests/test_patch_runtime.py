import ast
import unittest
from patch_runtime import patch_main, patch_routes

SOURCE = '''
import logging
logger = logging.getLogger(__name__)
def serialize_sse_event(event):
    return event
async def response_stream():
    original_system_instructions = "Retain original clinic instructions"
    try:
        logger.info(f"prompt={original_system_instructions}")
        yield serialize_sse_event({"type": "message", "content": "test"})
    except BaseException as e:
        logger.exception(str(e))
        yield serialize_sse_event({"type": "completed_message", "content": str(e)})
'''


class PatchTests(unittest.TestCase):
    def test_clinic_instructions_remain_while_error_and_log_bodies_are_removed(self):
        result = patch_routes(SOURCE)
        compile(result, "routes.py", "exec")
        self.assertIn("Retain original clinic instructions", result)
        self.assertNotIn("str(e)", result)
        self.assertNotIn("except BaseException", result)
        self.assertIn("'type': 'error'", result)
        tree = ast.parse(result)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and ast.unparse(node.func.value) == "logger":
                self.assertEqual(len(node.args), 1)
                self.assertIsInstance(node.args[0], ast.Constant)

    def test_registers_middleware_without_replacing_existing_router(self):
        result = patch_main('''
def create_app():
    app = fastapi.FastAPI()
    app.include_router(routes.router)
    return app
''')
        compile(result, "main.py", "exec")
        self.assertIn("app.include_router(routes.router)", result)
        self.assertIn("app.add_middleware(SessionPrivacyMiddleware)", result)

    def test_unexpected_backend_shape_fails_closed(self):
        with self.assertRaises(AssertionError):
            patch_routes("def other(): pass")
        with self.assertRaises(AssertionError):
            patch_main("def other(): pass")


if __name__ == "__main__":
    unittest.main()
