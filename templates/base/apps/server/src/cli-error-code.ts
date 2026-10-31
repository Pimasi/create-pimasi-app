import { wireValues } from "@pimasi/lib/values/wire";

export enum CliErrorCode {
    DUPLICATED_COMMAND = "DUPLICATED_CLI_COMMAND",
}
wireValues(CliErrorCode, ["DUPLICATED_CLI_COMMAND"]);
