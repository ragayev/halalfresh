import { Loader2 } from "lucide-react";
export const Spinner = ({ className = "size-5" }: { className?: string }) => (
  <Loader2 className={`${className} animate-spin`} aria-hidden />
);
