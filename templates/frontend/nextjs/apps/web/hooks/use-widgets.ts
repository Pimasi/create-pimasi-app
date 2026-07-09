import useSWR from "swr";
import type {
    Widget,
    CreateWidgetRequest,
    UpdateWidgetRequest,
} from "@pimasi/lib/schemas/api/widget.schema";
import { $server } from "@/lib/server";

export function useWidgets() {
    return useSWR("/widgets", async (url: string) => {
        let res = await $server<Widget[]>({ method: "GET", url });
        return res.data;
    });
}

export async function createWidget(input: CreateWidgetRequest) {
    let { data } = await $server<Widget>({
        method: "POST",
        url: "/widgets",
        data: input,
    });
    return data;
}

export async function updateWidget(id: string, input: UpdateWidgetRequest) {
    let { data } = await $server<Widget>({
        method: "PATCH",
        url: `/widgets/${id}`,
        data: input,
    });
    return data;
}

export async function deleteWidget(id: string) {
    let { data } = await $server<{ deleted: boolean }>({
        method: "DELETE",
        url: `/widgets/${id}`,
    });
    return data;
}
