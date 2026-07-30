import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({
    example: "J'ai redémarré le service, en attente de confirmation.",
  })
  @IsString()
  @IsNotEmpty()
  content: string;
}
