import {Suspense} from "react";
import {ApprovalsPage} from "@/components/approvals-page";
export default function Page(){return <Suspense fallback={<p>Loading approvals…</p>}><ApprovalsPage/></Suspense>;}
