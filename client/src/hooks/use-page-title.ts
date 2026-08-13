import { useEffect } from "react";

const SUFFIX = "نظام الحجز – بيت الإباء";

export function usePageTitle(pageTitle: string) {
  useEffect(() => {
    document.title = `${pageTitle} | ${SUFFIX}`;
    return () => {
      document.title = SUFFIX;
    };
  }, [pageTitle]);
}
