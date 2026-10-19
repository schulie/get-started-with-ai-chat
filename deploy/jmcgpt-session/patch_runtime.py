"""Apply reviewed privacy changes only to the pinned deployed backend."""
import ast
import hashlib
from pathlib import Path

ROUTE_SHA256 = "05cb223aa79e839b3bfa5c54b81a245eaadbc9a86cbb8a84cd5104cff38659ff"
LOG_METHODS = {"debug", "info", "warning", "warn", "error", "exception", "critical"}


class RedactContentLogs(ast.NodeTransformer):
    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Attribute) and node.func.attr in LOG_METHODS:
            owner = ast.unparse(node.func.value).lower()
            if "logger" in owner or owner == "logging":
                node.args = [ast.Constant(value="jmcgpt_application_event")]
                node.keywords = []
                if node.func.attr == "exception":
                    node.func.attr = "error"
        return node


def patch_routes(source):
    tree = ast.parse(source)
    streams = [node for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == "response_stream"]
    assert len(streams) == 1, "Expected the existing chat stream handler"
    assert any(isinstance(node, ast.FunctionDef) and node.name == "serialize_sse_event" for node in ast.walk(tree))
    handlers = [node for node in ast.walk(streams[0]) if isinstance(node, ast.ExceptHandler)]
    assert handlers, "Expected the existing provider failure handler"
    replacement = ast.parse('''
try:
    pass
except Exception:
    logger.warning("jmcgpt_provider_request_failed")
    yield serialize_sse_event({"type": "error", "error": {"code": "request_failed"}})
    return
''').body[0].handlers[0]
    for handler in handlers:
        handler.type = ast.Name(id="Exception", ctx=ast.Load())
        handler.name = None
        handler.body = replacement.body
    tree = RedactContentLogs().visit(tree)
    return ast.unparse(ast.fix_missing_locations(tree)) + "\n"


def patch_main(source):
    tree = ast.parse(source)
    creators = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "create_app"]
    assert len(creators) == 1, "Expected the existing application factory"
    factory = creators[0]
    returns = [i for i, node in enumerate(factory.body) if isinstance(node, ast.Return) and isinstance(node.value, ast.Name) and node.value.id == "app"]
    assert len(returns) == 1, "Expected a single application return"
    factory.body[returns[0]:returns[0]] = ast.parse('from .privacy import SessionPrivacyMiddleware\napp.add_middleware(SessionPrivacyMiddleware)').body
    tree = RedactContentLogs().visit(tree)
    return ast.unparse(ast.fix_missing_locations(tree)) + "\n"


def main(root=Path("/code/api")):
    routes = root / "routes.py"
    before = routes.read_bytes()
    assert hashlib.sha256(before).hexdigest() == ROUTE_SHA256, "Unexpected deployed route; inspect it before updating"
    after = patch_routes(before.decode())
    compile(after, str(routes), "exec")
    routes.write_text(after)
    app = root / "main.py"
    after = patch_main(app.read_text())
    compile(after, str(app), "exec")
    app.write_text(after)
    print("JMCGPT privacy patch verified against the pinned backend")


if __name__ == "__main__":
    main()
