"use client";
import { Card } from "./ui";
import { PostcodePanel } from "./delivery-ui";

/** Homepage delivery check: shares state with the first-open gate and the header chip. */
export function PostcodeChecker() {
  return (
    <Card className="p-4">
      <PostcodePanel />
    </Card>
  );
}
