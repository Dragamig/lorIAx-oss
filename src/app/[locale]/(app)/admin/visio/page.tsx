import { AdminVisioTab } from "./visio-tab";
import { BackToServices } from "@/components/admin/back-to-services";
export default function VisioPage() {
  return (
    <div className="pb-24">
      <BackToServices />
      <AdminVisioTab />
    </div>
  );
}
