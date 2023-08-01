-- This comes from: https://github.com/viascom/nanoid-postgres/blob/main/nanoid.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION nanoid(
    size int DEFAULT 21,
    alphabet text DEFAULT '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
)
    RETURNS text
    LANGUAGE plpgsql
    volatile
AS
$$
DECLARE
    idBuilder      text := '';
    counter        int  := 0;
    bytes          bytea;
    alphabetIndex  int;
    alphabetArray  text[];
    alphabetLength int;
    mask           int;
    step           int;
BEGIN
    alphabetArray := regexp_split_to_array(alphabet, '');
    alphabetLength := array_length(alphabetArray, 1);
    mask := (2 << cast(floor(log(alphabetLength - 1) / log(2)) as int)) - 1;
    step := cast(ceil(1.6 * mask * size / alphabetLength) AS int);

    while true
        loop
            bytes := gen_random_bytes(step);
            while counter < step
                loop
                    alphabetIndex := (get_byte(bytes, counter) & mask) + 1;
                    if alphabetIndex <= alphabetLength then
                        idBuilder := idBuilder || alphabetArray[alphabetIndex];
                        if length(idBuilder) = size then
                            return idBuilder;
                        end if;
                    end if;
                    counter := counter + 1;
                end loop;

            counter := 0;
        end loop;
END
$$;